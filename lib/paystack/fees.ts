// Paystack's standard published Nigeria rate: 1.5% of the amount, plus a
// flat ₦100 that's waived for amounts under ₦2,500, capped at ₦2,000
// total. This is the DEFAULT published rate — if this Paystack account has
// a negotiated custom rate, this is the one place to correct it.
const PERCENTAGE_RATE = 0.015
const FLAT_FEE_NGN = 100
const FLAT_FEE_WAIVED_BELOW_NGN = 2500
const FEE_CAP_NGN = 2000

export function computePaystackFee(amountNgn: number): number {
  const percentageFee = amountNgn * PERCENTAGE_RATE
  const flatFee = amountNgn < FLAT_FEE_WAIVED_BELOW_NGN ? 0 : FLAT_FEE_NGN
  const fee = Math.round(percentageFee + flatFee)
  return Math.min(fee, FEE_CAP_NGN)
}
