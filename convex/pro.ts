import { v } from 'convex/values';
import { query } from './_generated/server';

/**
 * Agrégats du **cockpit agence** (back-office pro).
 *
 * Une seule query qui calcule, côté serveur, tout ce dont le tableau de bord a
 * besoin à partir des données réelles : quotas (events actifs, stockage,
 * messages du mois, sièges), KPIs (mariages actifs, RSVP en attente) et la
 * liste des prochains mariages avec leur progression RSVP.
 *
 * Volontairement calculé en une passe (pas de mock) — les cartes du cockpit qui
 * n'ont pas encore de source de données réelle (rétroplanning, pipeline CRM,
 * CA agence) sont rendues en état « à venir » côté UI plutôt que remplies de
 * fausses valeurs.
 *
 * Coût : O(events × (invités + photos)). Acceptable à l'échelle d'une agence
 * (≤ 50 events actifs) ; à dénormaliser via compteurs si le volume grandit.
 */

const MS_PER_DAY = 86_400_000;

/** Début du mois courant (UTC) — pour le quota de messages mensuel. */
function startOfMonthUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export const cockpit = query({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const membership = await ctx.db
      .query('organizationMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('status'), 'active'))
      .first();
    if (!membership) return null;

    const org = await ctx.db.get(membership.organizationId);
    if (!org) return null;

    const logoUrl = org.logoStorageId ? await ctx.storage.getUrl(org.logoStorageId) : null;

    // Sièges : un membre actif ET une invitation en attente occupent un siège.
    const memberships = await ctx.db
      .query('organizationMemberships')
      .withIndex('by_organization', (q) => q.eq('organizationId', org._id))
      .collect();
    const seatsUsed = memberships.filter(
      (m) => m.status === 'active' || m.status === 'pending',
    ).length;

    const events = await ctx.db
      .query('events')
      .withIndex('by_organization', (q) => q.eq('organizationId', org._id))
      .collect();

    const now = Date.now();
    const monthStart = startOfMonthUtc(now);

    let pendingRsvp = 0;
    let storageBytes = 0;
    let messagesThisMonth = 0;

    const perEvent = new Map<string, { attending: number; pending: number; total: number }>();
    // Tendance des réponses RSVP sur 14 jours (sparkline cockpit) — données réelles
    // dérivées de `rsvpRespondedAt`, index 13 = aujourd'hui.
    const RSVP_TREND_DAYS = 14;
    const rsvpTrend: number[] = new Array(RSVP_TREND_DAYS).fill(0);

    for (const ev of events) {
      const guests = await ctx.db
        .query('guests')
        .withIndex('by_event', (q) => q.eq('eventId', ev._id))
        .collect();

      let attending = 0;
      let pending = 0;
      for (const g of guests) {
        if (g.rsvpStatus === 'attending') attending += 1;
        else if (g.rsvpStatus === 'pending') pending += 1;
        // Messages envoyés ce mois-ci (invitation + relances J-7 / J-1).
        if (g.invitationSentAt && g.invitationSentAt >= monthStart) messagesThisMonth += 1;
        if (g.reminderD7SentAt && g.reminderD7SentAt >= monthStart) messagesThisMonth += 1;
        if (g.reminderD1SentAt && g.reminderD1SentAt >= monthStart) messagesThisMonth += 1;
        if (g.rsvpRespondedAt != null) {
          const idx = RSVP_TREND_DAYS - 1 - Math.floor((now - g.rsvpRespondedAt) / MS_PER_DAY);
          if (idx >= 0 && idx < RSVP_TREND_DAYS) rsvpTrend[idx] = (rsvpTrend[idx] ?? 0) + 1;
        }
      }
      perEvent.set(ev._id, { attending, pending, total: guests.length });
      if (ev.status === 'active') pendingRsvp += pending;

      const photos = await ctx.db
        .query('photos')
        .withIndex('by_event', (q) => q.eq('eventId', ev._id))
        .collect();
      for (const p of photos) storageBytes += p.sizeBytes ?? 0;
    }

    const activeEvents = events.filter((e) => e.status === 'active');
    const draftEvents = events.filter((e) => e.status === 'draft');

    // Pipeline CRM — comptage des clients par étape (mini-entonnoir du cockpit).
    const clients = await ctx.db
      .query('clients')
      .withIndex('by_organization', (q) => q.eq('organizationId', org._id))
      .collect();
    const PIPELINE_STAGES = [
      'lead',
      'contacted',
      'quote',
      'booked',
      'in_progress',
      'delivered',
    ] as const;
    const pipeline = PIPELINE_STAGES.map((stage) => ({
      stage,
      count: clients.filter((c) => c.stage === stage).length,
    }));

    // Prochaines échéances de rétroplanning (tâches non faites avec date).
    const planningTasks = await ctx.db
      .query('planningTasks')
      .withIndex('by_organization', (q) => q.eq('organizationId', org._id))
      .collect();
    const deadlines = planningTasks
      .filter((t) => !t.done && t.dueDate != null)
      .sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0))
      .slice(0, 5)
      .map((t) => ({
        _id: t._id,
        title: t.title,
        dueDate: t.dueDate ?? now,
        daysUntil: Math.ceil(((t.dueDate ?? now) - now) / MS_PER_DAY),
        eventId: t.eventId,
      }));
    const overdueTasks = planningTasks.filter(
      (t) => !t.done && t.dueDate != null && t.dueDate < now,
    ).length;

    // Activité récente — flux dérivé (clients ajoutés, tâches terminées,
    // mariages créés/publiés), trié par fraîcheur. `daysAgo` précalculé pour
    // un rendu serveur stable (pas de Date.now() côté client).
    const activityRaw: Array<{
      kind: 'client' | 'task' | 'event' | 'event_draft';
      label: string;
      at: number;
    }> = [];
    for (const c of clients) {
      const name = c.partnerB ? `${c.partnerA} & ${c.partnerB}` : c.partnerA;
      activityRaw.push({ kind: 'client', label: `Nouveau client · ${name}`, at: c.createdAt });
    }
    for (const t of planningTasks) {
      if (t.done)
        activityRaw.push({ kind: 'task', label: `Tâche terminée · ${t.title}`, at: t.updatedAt });
    }
    for (const e of events) {
      const name = `${e.coupleNames.partnerA} & ${e.coupleNames.partnerB}`;
      if (e.status === 'active')
        activityRaw.push({ kind: 'event', label: `Mariage actif · ${name}`, at: e.updatedAt });
      else if (e.status === 'draft')
        activityRaw.push({ kind: 'event_draft', label: `Mariage créé · ${name}`, at: e.createdAt });
    }
    const recentActivity = activityRaw
      .sort((a, b) => b.at - a.at)
      .slice(0, 6)
      .map((a) => ({
        kind: a.kind,
        label: a.label,
        daysAgo: Math.max(0, Math.floor((now - a.at) / MS_PER_DAY)),
      }));

    // ---- KPIs enrichis (deltas + mini-séries hebdo, toutes réelles) ----
    const WEEKS = 8;
    const MS_PER_WEEK = 7 * MS_PER_DAY;
    const weekIndexOf = (ts: number): number => WEEKS - 1 - Math.floor((now - ts) / MS_PER_WEEK);
    const newSeries = (): number[] => new Array(WEEKS).fill(0);

    // Mariages créés par semaine + ce mois-ci.
    const weddingsSpark = newSeries();
    for (const e of events) {
      const i = weekIndexOf(e.createdAt);
      if (i >= 0 && i < WEEKS) weddingsSpark[i] = (weddingsSpark[i] ?? 0) + 1;
    }
    const weddingsThisMonth = events.filter((e) => e.createdAt >= monthStart).length;

    // Tâches terminées par semaine (proxy d'avancement rétroplanning).
    const tasksDoneSpark = newSeries();
    for (const t of planningTasks) {
      if (!t.done) continue;
      const i = weekIndexOf(t.updatedAt);
      if (i >= 0 && i < WEEKS) tasksDoneSpark[i] = (tasksDoneSpark[i] ?? 0) + 1;
    }

    // Échéances à venir cette semaine (J0 → J+7).
    const weekEnd = now + 7 * MS_PER_DAY;
    const weekDeadlines = planningTasks.filter(
      (t) => !t.done && t.dueDate != null && t.dueDate >= now && t.dueDate <= weekEnd,
    ).length;

    // Réponses RSVP sur les 7 derniers jours (delta du KPI RSVP).
    const respondedLast7 = rsvpTrend.slice(RSVP_TREND_DAYS - 7).reduce((a, b) => a + b, 0);

    // CA encaissé : somme des échéances de factures réglées + série hebdo.
    const invoices = await ctx.db
      .query('quoteDocs')
      .withIndex('by_org_type', (q) => q.eq('organizationId', org._id).eq('type', 'invoice'))
      .collect();
    let collectedMinor = 0;
    let paidInvoicesCount = 0;
    const revenueSpark = newSeries();
    for (const inv of invoices) {
      let invPaidMinor = 0;
      for (const s of inv.schedule ?? []) if (s.paid) invPaidMinor += s.amountMinor;
      collectedMinor += invPaidMinor;
      if (invPaidMinor > 0) paidInvoicesCount += 1;
      const i = weekIndexOf(inv.issueDate ?? inv.createdAt);
      if (i >= 0 && i < WEEKS)
        revenueSpark[i] = (revenueSpark[i] ?? 0) + Math.round(invPaidMinor / 100);
    }

    // Libellé couple par event (pour les pastilles de tâches).
    const coupleById = new Map(
      events.map((e) => [e._id, `${e.coupleNames.partnerA} & ${e.coupleNames.partnerB}`]),
    );
    const deadlinesRich = deadlines.map((d) => ({
      ...d,
      coupleLabel: coupleById.get(d.eventId) ?? '',
    }));

    const upcoming = events
      .filter((e) => e.status === 'active' || e.status === 'draft')
      .sort((a, b) => a.eventDate - b.eventDate)
      .slice(0, 6)
      .map((e) => {
        const counts = perEvent.get(e._id) ?? { attending: 0, pending: 0, total: 0 };
        return {
          _id: e._id,
          partnerA: e.coupleNames.partnerA,
          partnerB: e.coupleNames.partnerB,
          eventDate: e.eventDate,
          timezone: e.timezone,
          venue: e.venue?.name,
          daysUntil: Math.ceil((e.eventDate - now) / MS_PER_DAY),
          rsvpAttending: counts.attending,
          rsvpTotal: counts.total,
          status: e.status,
        };
      });

    return {
      org: {
        _id: org._id,
        name: org.name,
        slug: org.slug,
        primaryColor: org.primaryColor,
        logoUrl,
        subscriptionTier: org.subscriptionTier,
        subscriptionStatus: org.subscriptionStatus,
        subscriptionPeriodEnd: org.subscriptionPeriodEnd,
        paygCredits: org.paygCredits ?? 0,
        compedSubscription: org.compedSubscription ?? null,
      },
      myRole: membership.role,
      usage: {
        activeEvents: activeEvents.length,
        storageBytes,
        whatsappMessagesThisMonth: messagesThisMonth,
        seatsUsed,
      },
      kpis: {
        activeWeddings: activeEvents.length,
        pendingRsvp,
        totalEvents: events.length,
        draftEvents: draftEvents.length,
        weekDeadlines,
        weddingsThisMonth,
        respondedLast7,
        collectedMinor,
        paidInvoicesCount,
      },
      kpiTrends: {
        weddings: weddingsSpark,
        rsvp: rsvpTrend,
        tasksDone: tasksDoneSpark,
        revenue: revenueSpark,
      },
      upcoming,
      pipeline,
      deadlines: deadlinesRich,
      overdueTasks,
      recentActivity,
      rsvpTrend,
    };
  },
});
