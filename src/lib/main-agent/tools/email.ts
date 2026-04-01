import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { sendEmail } from "@/lib/email";
import { agentNotificationEmail } from "@/lib/email-templates";
import { env, hasResendConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { ToolCatalogEntry, ToolRuntimeContext } from "./context";
import { jsonResult } from "./context";

export const emailCatalog: ToolCatalogEntry = {
  id: "send_email",
  label: "Send email",
  runtime: "main_agent",
  kind: "custom_backend",
  enabled: true,
  description: "Send an email notification to the current user with results or updates.",
};

export function createEmailTool(ctx: ToolRuntimeContext) {
  return betaZodTool({
    name: "send_email",
    description:
      "Send an email to the current user. Use when the user asks to be notified, emailed, or requests results via email. The email is sent to the user's registered email address — you do not need to ask for it.",
    inputSchema: z.object({
      subject: z.string().max(200).describe("Email subject line — concise and descriptive."),
      body: z.string().describe("Email body content in markdown format. Will be rendered as styled HTML."),
    }),
    async run(input) {
      const toolName = "send_email";

      if (!hasResendConfig()) {
        await ctx.emit("tool.call.failed", { toolName, input, error: "Email service not configured" });
        return jsonResult({ error: "Email is not configured in this workspace." });
      }

      try {
        const [user, conversation] = await Promise.all([
          prisma.userProfile.findUnique({ where: { userId: ctx.userId }, select: { email: true } }),
          prisma.conversation.findUnique({ where: { id: ctx.conversationId }, select: { title: true } }),
        ]);

        if (!user?.email) {
          await ctx.emit("tool.call.failed", { toolName, input, error: "No email found" });
          return jsonResult({ error: "Could not find your email address." });
        }

        const email = agentNotificationEmail({
          message: input.body,
          conversationUrl: `${env.APP_URL}/chat/${ctx.conversationId}`,
          conversationTitle: conversation?.title ?? "Conversation",
        });

        const result = await sendEmail({ to: user.email, subject: input.subject, html: email.html });

        if (result.success) {
          await ctx.emit("tool.call.completed", { toolName, input, result: `Email sent to ${user.email}` });
          return jsonResult({ success: true, sentTo: user.email });
        }

        await ctx.emit("tool.call.failed", { toolName, input, error: result.error });
        return jsonResult({ error: `Failed to send: ${result.error}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        await ctx.emit("tool.call.failed", { toolName, input, error: msg });
        return jsonResult({ error: msg });
      }
    },
  });
}
