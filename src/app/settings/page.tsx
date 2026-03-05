import { SettingsCenter } from "@/components/settings-center";
import { requireOnboardedAppUser } from "@/lib/app-state";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user } = await requireOnboardedAppUser();
  return <SettingsCenter userEmail={user.email} />;
}
