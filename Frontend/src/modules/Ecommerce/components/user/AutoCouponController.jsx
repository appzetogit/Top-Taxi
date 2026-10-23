import useAutoCouponEngine from "@ecommerce/hooks/useAutoCouponEngine"
import AutoCouponCelebration from "@ecommerce/components/user/AutoCouponCelebration"

export default function AutoCouponController() {
  useAutoCouponEngine({ enabled: true })
  return <AutoCouponCelebration />
}
