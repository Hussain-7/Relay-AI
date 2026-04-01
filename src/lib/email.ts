import { Resend } from "resend";

import { env, hasResendConfig } from "@/lib/env";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!hasResendConfig()) {
    console.warn("[email] RESEND_API_KEY not set, skipping email");
    return { success: false, error: "Email not configured" };
  }

  try {
    console.log("[email] sending to", options.to, "subject:", options.subject);
    const { error } = await getResend().emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      console.error("[email] send failed:", error.message);
      return { success: false, error: error.message };
    }

    console.log("[email] sent successfully to", options.to);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] send threw:", msg);
    return { success: false, error: msg };
  }
}
