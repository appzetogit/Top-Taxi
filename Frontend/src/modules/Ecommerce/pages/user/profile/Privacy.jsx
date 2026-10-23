import CMSPage from "@ecommerce/components/user/CMSPage"
import { API_ENDPOINTS } from "@ecommerce/services/api/config"

export default function Privacy() {
  return (
    <CMSPage 
      endpoint={API_ENDPOINTS.ADMIN.PRIVACY_PUBLIC} 
      title="Privacy Policy" 
      module="USER"
    />
  )
}
