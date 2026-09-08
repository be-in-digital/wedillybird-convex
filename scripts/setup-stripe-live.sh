#!/usr/bin/env bash
# setup-stripe-live.sh — Creates all live Stripe products and prices for Wedillybird.
# Usage: STRIPE_LIVE_KEY=sk_live_... bash scripts/setup-stripe-live.sh
# The script writes the resulting price IDs directly into .env.local.

set -euo pipefail

KEY="${STRIPE_LIVE_KEY:-}"
if [[ -z "$KEY" ]]; then
  echo "❌  STRIPE_LIVE_KEY is not set."
  echo "    Export your live secret key first:"
  echo "    export STRIPE_LIVE_KEY=sk_live_..."
  exit 1
fi

ENV_FILE="$(dirname "$0")/../.env.local"
BASE_URL="https://api.stripe.com/v1"

_post() {
  local endpoint="$1"; shift
  curl -s -X POST "$BASE_URL/$endpoint" \
    -u "$KEY:" \
    "$@"
}

_jq() { python3 -c "import sys,json; data=json.load(sys.stdin); print(data$1)"; }

echo "→ Creating products..."

# ── Individual plans ──────────────────────────────────────────────────────────
PROD_ESSENTIAL=$(_post products \
  -d "name=Wedillybird — Essentiel" \
  -d "description=Invitations WhatsApp + RSVP temps réel + check-in offline + tableau de bord + galerie 30 jours." \
  -d "metadata[key]=essential" | _jq "['id']")
echo "  essential: $PROD_ESSENTIAL"

PROD_PREMIUM=$(_post products \
  -d "name=Wedillybird — Premium" \
  -d "description=Tout l'Essentiel + galerie 6 mois + album PDF final imprimable." \
  -d "metadata[key]=premium" | _jq "['id']")
echo "  premium:   $PROD_PREMIUM"

PROD_UPSELL=$(_post products \
  -d "name=Wedillybird — Extension galerie post-mariage" \
  -d "description=Extension galerie partagée +6 mois + album PDF (ajout après l'événement)." \
  -d "metadata[key]=post_event_upsell" | _jq "['id']")
echo "  upsell:    $PROD_UPSELL"

# ── Pro plans ─────────────────────────────────────────────────────────────────
PROD_STARTER=$(_post products \
  -d "name=Wedillybird Pro — Starter" \
  -d "description=1 événement actif, 300 invités max, marque blanche." \
  -d "metadata[key]=starter" | _jq "['id']")
echo "  starter:   $PROD_STARTER"

PROD_BUSINESS=$(_post products \
  -d "name=Wedillybird Pro — Business" \
  -d "description=5 événements actifs, 1 000 invités max, analytics, priorité support." \
  -d "metadata[key]=business" | _jq "['id']")
echo "  business:  $PROD_BUSINESS"

PROD_AGENCY=$(_post products \
  -d "name=Wedillybird Pro — Agency" \
  -d "description=Événements illimités, invités illimités, SLA 4h, API accès." \
  -d "metadata[key]=agency" | _jq "['id']")
echo "  agency:    $PROD_AGENCY"

PROD_PAYG=$(_post products \
  -d "name=Wedillybird Pro — Pay-as-you-go" \
  -d "description=Achat d'un créneau événement supplémentaire (one-shot)." \
  -d "metadata[key]=payg" | _jq "['id']")
echo "  payg:      $PROD_PAYG"

echo ""
echo "→ Creating prices (EUR)..."

# Individual EUR
P_ESSENTIAL_EUR=$(_post prices \
  -d "product=$PROD_ESSENTIAL" \
  -d "unit_amount=1900" \
  -d "currency=eur" \
  -d "metadata[plan]=essential" | _jq "['id']")
echo "  ESSENTIAL EUR 19€:   $P_ESSENTIAL_EUR"

P_PREMIUM_EUR=$(_post prices \
  -d "product=$PROD_PREMIUM" \
  -d "unit_amount=4900" \
  -d "currency=eur" \
  -d "metadata[plan]=premium" | _jq "['id']")
echo "  PREMIUM EUR 49€:     $P_PREMIUM_EUR"

P_UPSELL_EUR=$(_post prices \
  -d "product=$PROD_UPSELL" \
  -d "unit_amount=2900" \
  -d "currency=eur" \
  -d "metadata[plan]=post_event_upsell" | _jq "['id']")
echo "  UPSELL EUR 29€:      $P_UPSELL_EUR"

# Pro monthly EUR
P_STARTER_EUR=$(_post prices \
  -d "product=$PROD_STARTER" \
  -d "unit_amount=8900" \
  -d "currency=eur" \
  -d "recurring[interval]=month" \
  -d "metadata[tier]=starter" -d "metadata[billing]=monthly" | _jq "['id']")
echo "  STARTER EUR 89€/mo:  $P_STARTER_EUR"

P_BUSINESS_EUR=$(_post prices \
  -d "product=$PROD_BUSINESS" \
  -d "unit_amount=17900" \
  -d "currency=eur" \
  -d "recurring[interval]=month" \
  -d "metadata[tier]=business" -d "metadata[billing]=monthly" | _jq "['id']")
echo "  BUSINESS EUR 179€/mo: $P_BUSINESS_EUR"

P_AGENCY_EUR=$(_post prices \
  -d "product=$PROD_AGENCY" \
  -d "unit_amount=34900" \
  -d "currency=eur" \
  -d "recurring[interval]=month" \
  -d "metadata[tier]=agency" -d "metadata[billing]=monthly" | _jq "['id']")
echo "  AGENCY EUR 349€/mo:  $P_AGENCY_EUR"

# Pro annual EUR (-20%: 89*12*0.8=854.40→85440, 179*12*0.8=1718.40→171840, 349*12*0.8=3350.40→335040)
P_STARTER_ANNUAL_EUR=$(_post prices \
  -d "product=$PROD_STARTER" \
  -d "unit_amount=85440" \
  -d "currency=eur" \
  -d "recurring[interval]=year" \
  -d "metadata[tier]=starter" -d "metadata[billing]=annual" | _jq "['id']")
echo "  STARTER EUR 854€/yr: $P_STARTER_ANNUAL_EUR"

P_BUSINESS_ANNUAL_EUR=$(_post prices \
  -d "product=$PROD_BUSINESS" \
  -d "unit_amount=171840" \
  -d "currency=eur" \
  -d "recurring[interval]=year" \
  -d "metadata[tier]=business" -d "metadata[billing]=annual" | _jq "['id']")
echo "  BUSINESS EUR 1718€/yr: $P_BUSINESS_ANNUAL_EUR"

P_AGENCY_ANNUAL_EUR=$(_post prices \
  -d "product=$PROD_AGENCY" \
  -d "unit_amount=335040" \
  -d "currency=eur" \
  -d "recurring[interval]=year" \
  -d "metadata[tier]=agency" -d "metadata[billing]=annual" | _jq "['id']")
echo "  AGENCY EUR 3350€/yr: $P_AGENCY_ANNUAL_EUR"

P_PAYG_EUR=$(_post prices \
  -d "product=$PROD_PAYG" \
  -d "unit_amount=6900" \
  -d "currency=eur" \
  -d "metadata[kind]=payg" | _jq "['id']")
echo "  PAYG EUR 69€:        $P_PAYG_EUR"

echo ""
echo "→ Creating prices (MAD)..."

# Individual MAD
P_ESSENTIAL_MAD=$(_post prices \
  -d "product=$PROD_ESSENTIAL" \
  -d "unit_amount=21000" \
  -d "currency=mad" \
  -d "metadata[plan]=essential" | _jq "['id']")
echo "  ESSENTIAL MAD 210:   $P_ESSENTIAL_MAD"

P_PREMIUM_MAD=$(_post prices \
  -d "product=$PROD_PREMIUM" \
  -d "unit_amount=53000" \
  -d "currency=mad" \
  -d "metadata[plan]=premium" | _jq "['id']")
echo "  PREMIUM MAD 530:     $P_PREMIUM_MAD"

P_UPSELL_MAD=$(_post prices \
  -d "product=$PROD_UPSELL" \
  -d "unit_amount=32000" \
  -d "currency=mad" \
  -d "metadata[plan]=post_event_upsell" | _jq "['id']")
echo "  UPSELL MAD 320:      $P_UPSELL_MAD"

# Pro monthly MAD
P_STARTER_MAD=$(_post prices \
  -d "product=$PROD_STARTER" \
  -d "unit_amount=95200" \
  -d "currency=mad" \
  -d "recurring[interval]=month" \
  -d "metadata[tier]=starter" -d "metadata[billing]=monthly" | _jq "['id']")
echo "  STARTER MAD 952/mo:  $P_STARTER_MAD"

P_BUSINESS_MAD=$(_post prices \
  -d "product=$PROD_BUSINESS" \
  -d "unit_amount=191500" \
  -d "currency=mad" \
  -d "recurring[interval]=month" \
  -d "metadata[tier]=business" -d "metadata[billing]=monthly" | _jq "['id']")
echo "  BUSINESS MAD 1915/mo: $P_BUSINESS_MAD"

P_AGENCY_MAD=$(_post prices \
  -d "product=$PROD_AGENCY" \
  -d "unit_amount=373400" \
  -d "currency=mad" \
  -d "recurring[interval]=month" \
  -d "metadata[tier]=agency" -d "metadata[billing]=monthly" | _jq "['id']")
echo "  AGENCY MAD 3734/mo:  $P_AGENCY_MAD"

# Pro annual MAD (-20%)
P_STARTER_ANNUAL_MAD=$(_post prices \
  -d "product=$PROD_STARTER" \
  -d "unit_amount=914880" \
  -d "currency=mad" \
  -d "recurring[interval]=year" \
  -d "metadata[tier]=starter" -d "metadata[billing]=annual" | _jq "['id']")
echo "  STARTER MAD 9149/yr: $P_STARTER_ANNUAL_MAD"

P_BUSINESS_ANNUAL_MAD=$(_post prices \
  -d "product=$PROD_BUSINESS" \
  -d "unit_amount=183840" \
  -d "currency=mad" \
  -d "recurring[interval]=year" \
  -d "metadata[tier]=business" -d "metadata[billing]=annual" | _jq "['id']")
echo "  BUSINESS MAD 1838/yr: $P_BUSINESS_ANNUAL_MAD"

P_AGENCY_ANNUAL_MAD=$(_post prices \
  -d "product=$PROD_AGENCY" \
  -d "unit_amount=358560" \
  -d "currency=mad" \
  -d "recurring[interval]=year" \
  -d "metadata[tier]=agency" -d "metadata[billing]=annual" | _jq "['id']")
echo "  AGENCY MAD 3586/yr:  $P_AGENCY_ANNUAL_MAD"

P_PAYG_MAD=$(_post prices \
  -d "product=$PROD_PAYG" \
  -d "unit_amount=73800" \
  -d "currency=mad" \
  -d "metadata[kind]=payg" | _jq "['id']")
echo "  PAYG MAD 738:        $P_PAYG_MAD"

# ── Update .env.local ─────────────────────────────────────────────────────────
echo ""
echo "→ Updating $ENV_FILE ..."

PUB_KEY="pk_live_51TQ1Sp00M17SL8WBhUniXikrmfE1YWJT3zGCffvJ0y1at3QkO71Kju4vLArSfcs3pvWat5mrRvhqHeh11hvIW5V600rgsJDPrc"

python3 - <<PYEOF
import re, pathlib

env = pathlib.Path("$ENV_FILE").read_text()

replacements = {
    # Keys
    r'^(# Stripe — ).*$': r'\1live mode',
    r'^(STRIPE_SECRET_KEY=).*$': r'\1$KEY',
    r'^(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=).*$': r'\1$PUB_KEY',
    # EUR prices
    r'^(STRIPE_PRICE_ESSENTIAL_EUR=).*$': r'\1$P_ESSENTIAL_EUR',
    r'^(STRIPE_PRICE_PREMIUM_EUR=).*$': r'\1$P_PREMIUM_EUR',
    r'^(STRIPE_PRICE_POST_EVENT_UPSELL_EUR=).*$': r'\1$P_UPSELL_EUR',
    r'^(STRIPE_PRICE_STARTER_EUR=).*$': r'\1$P_STARTER_EUR',
    r'^(STRIPE_PRICE_BUSINESS_EUR=).*$': r'\1$P_BUSINESS_EUR',
    r'^(STRIPE_PRICE_AGENCY_EUR=).*$': r'\1$P_AGENCY_EUR',
    r'^(STRIPE_PRICE_STARTER_ANNUAL_EUR=).*$': r'\1$P_STARTER_ANNUAL_EUR',
    r'^(STRIPE_PRICE_BUSINESS_ANNUAL_EUR=).*$': r'\1$P_BUSINESS_ANNUAL_EUR',
    r'^(STRIPE_PRICE_AGENCY_ANNUAL_EUR=).*$': r'\1$P_AGENCY_ANNUAL_EUR',
    r'^(STRIPE_PRICE_PAYG_EVENT_EUR=).*$': r'\1$P_PAYG_EUR',
    # MAD prices
    r'^(STRIPE_PRICE_ESSENTIAL_MAD=).*$': r'\1$P_ESSENTIAL_MAD',
    r'^(STRIPE_PRICE_PREMIUM_MAD=).*$': r'\1$P_PREMIUM_MAD',
    r'^(STRIPE_PRICE_POST_EVENT_UPSELL_MAD=).*$': r'\1$P_UPSELL_MAD',
    r'^(STRIPE_PRICE_STARTER_MAD=).*$': r'\1$P_STARTER_MAD',
    r'^(STRIPE_PRICE_BUSINESS_MAD=).*$': r'\1$P_BUSINESS_MAD',
    r'^(STRIPE_PRICE_AGENCY_MAD=).*$': r'\1$P_AGENCY_MAD',
    r'^(STRIPE_PRICE_STARTER_ANNUAL_MAD=).*$': r'\1$P_STARTER_ANNUAL_MAD',
    r'^(STRIPE_PRICE_BUSINESS_ANNUAL_MAD=).*$': r'\1$P_BUSINESS_ANNUAL_MAD',
    r'^(STRIPE_PRICE_AGENCY_ANNUAL_MAD=).*$': r'\1$P_AGENCY_ANNUAL_MAD',
    r'^(STRIPE_PRICE_PAYG_EVENT_MAD=).*$': r'\1$P_PAYG_MAD',
}

for pattern, repl in replacements.items():
    env = re.sub(pattern, repl, env, flags=re.MULTILINE)

pathlib.Path("$ENV_FILE").write_text(env)
print("  .env.local updated.")
PYEOF

echo ""
echo "✅  Done! Live products and prices created."
echo "    Remember to also:"
echo "    1. Create a live webhook in Stripe Dashboard → Developers → Webhooks"
echo "       pointing to https://<your-prod-domain>/api/webhooks/stripe"
echo "       (events: checkout.session.completed, checkout.session.async_payment_failed,"
echo "                customer.subscription.*, invoice.paid, invoice.payment_failed,"
echo "                charge.refunded, charge.dispute.created)"
echo "       charge.refunded / charge.dispute.created sont REQUIS pour que le"
echo "       remboursement reprenne la commission d'affiliation et restitue le"
echo "       crédit de parrainage — sans eux, une vente remboursée depuis le"
echo "       Dashboard continue de payer le partenaire."
echo "    2. Copy the live webhook signing secret (whsec_live_...) into .env.local"
echo "       as STRIPE_WEBHOOK_SECRET"
echo "    3. Set all Stripe env vars in your Convex production deployment"
