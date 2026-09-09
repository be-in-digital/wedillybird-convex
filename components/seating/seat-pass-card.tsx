import { getTranslations } from 'next-intl/server';

export interface SeatPassMemberView {
  memberIndex: number;
  fullName: string;
  tableName: string | null;
  seatNumber: number | null;
}

/**
 * Le carton de table numérique : table en grand (Bodoni italique, comme la
 * papeterie), numéro de chaise en mono, puis le reste de la tablée.
 *
 * L'information tient dans le premier écran, sans défilement : c'est ce que
 * l'invité regarde en marchant vers la salle, une main sur son téléphone.
 */
export async function SeatPassCard({
  members,
  numbering,
}: {
  members: SeatPassMemberView[];
  numbering: 'table' | 'seat';
}) {
  const t = await getTranslations('SeatPass');
  const me = members[0]!;
  const others = members.slice(1);

  return (
    <section className="flex flex-col gap-6">
      {/* Placement du porteur du lien */}
      <div className="rounded-3xl border border-[color:var(--color-champagne-300)] bg-[color:var(--color-ivory-50)] px-6 py-8 text-center shadow-sm">
        <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
          {t('tableLabel')}
        </span>
        <p
          className="font-display mt-2 text-balance italic"
          style={{
            fontSize: 'clamp(2rem, 6vw, 3rem)',
            lineHeight: 1.05,
            color: 'var(--color-ink-900)',
          }}
        >
          {me.tableName ?? '—'}
        </p>

        {numbering === 'seat' ? (
          me.seatNumber !== null ? (
            <p className="mt-5 flex flex-col items-center gap-1">
              <span className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
                {t('seatLabel')}
              </span>
              <span
                className="flex h-16 w-16 items-center justify-center rounded-full font-mono text-2xl"
                style={{
                  background: 'var(--color-champagne-100)',
                  border: '1px solid var(--color-champagne-500)',
                  color: 'var(--color-ink-900)',
                }}
              >
                {me.seatNumber}
              </span>
            </p>
          ) : (
            <p className="mt-4 text-sm text-[color:var(--color-ink-400)]">{t('seatFree')}</p>
          )
        ) : null}
      </div>

      {/* Accompagnants — l'invité vérifie d'un coup d'œil qu'on ne l'a pas
          séparé de sa famille. */}
      {others.length > 0 ? (
        <div className="rounded-2xl border border-[color:var(--color-champagne-300)] bg-white/60 px-5 py-4">
          <h2 className="font-mono text-[10px] tracking-[0.32em] text-[color:var(--color-ink-500)] uppercase">
            {t('partyTitle')}
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.memberIndex}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
              >
                <span className="text-[color:var(--color-ink-900)]">
                  {m.fullName}
                  {m.memberIndex === 0 ? (
                    <span className="ml-2 rounded-full bg-[color:var(--color-champagne-100)] px-2 py-0.5 font-mono text-[10px] tracking-widest text-[color:var(--color-ink-500)] uppercase">
                      {t('youBadge')}
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-xs text-[color:var(--color-ink-400)]">
                  {m.tableName === null
                    ? '—'
                    : numbering === 'seat' && m.seatNumber !== null
                      ? `${m.tableName} · ${t('seatLabel').toLowerCase()} ${m.seatNumber}`
                      : m.tableName}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
