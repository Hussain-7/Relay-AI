// ── Brand constants ──

const BRAND = {
  bg: "#1a1917",
  cardBg: "#262422",
  text: "#d4cfc5",
  textMuted: "#8a8580",
  textFaint: "#5a5650",
  heading: "#f1eee7",
  accent: "#dd7148",
  border: "#2f2d2a",
  link: "#dd7148",
};

// ── Markdown → HTML ──

function markdownToHtml(text: string): string {
  return text
    .replace(/^### (.+)$/gm, `<h3 style="margin:16px 0 8px;font-size:16px;color:${BRAND.heading};">$1</h3>`)
    .replace(/^## (.+)$/gm, `<h2 style="margin:16px 0 8px;font-size:18px;color:${BRAND.heading};">$1</h2>`)
    .replace(/^# (.+)$/gm, `<h1 style="margin:16px 0 8px;font-size:20px;color:${BRAND.heading};">$1</h1>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-*] (.+)$/gm, `<li style="margin:2px 0;color:${BRAND.text};">$1</li>`)
    .replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="margin:8px 0;padding-left:20px;">$1</ul>')
    .replace(/^---$/gm, `<hr style="border:none;border-top:1px solid ${BRAND.border};margin:16px 0;">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" style="color:${BRAND.link};text-decoration:none;">$1</a>`)
    .replace(/\n\n/g, `</p><p style="margin:8px 0;color:${BRAND.text};line-height:1.6;">`)
    .replace(/\n/g, "<br>");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Base template ──

function baseTemplate(options: { content: string; preheader?: string; footerNote?: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>Relay AI</title>
  ${options.preheader ? `<span style="display:none;max-height:0;overflow:hidden;">${escapeHtml(options.preheader)}</span>` : ""}
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Outer wrapper for email clients -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <!-- Inner container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="padding:0 0 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <!-- Brand star icon -->
                    <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 10.9 10.1 9 12 3.5Z" fill="${BRAND.accent}"/>
                    </svg>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:18px;font-weight:700;color:${BRAND.heading};letter-spacing:-0.02em;">Relay AI</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td>
              ${options.content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:32px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid ${BRAND.border};padding:20px 0 0;">
                    ${options.footerNote ? `<p style="margin:0 0 8px;font-size:12px;color:${BRAND.textFaint};line-height:1.5;">${options.footerNote}</p>` : ""}
                    <p style="margin:0;font-size:12px;color:${BRAND.textFaint};">
                      Sent by <span style="color:${BRAND.textMuted};">Relay AI</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
    <tr>
      <td style="background:${BRAND.accent};border-radius:8px;">
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;letter-spacing:0.01em;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
    <tr>
      <td style="background:${BRAND.cardBg};border-radius:12px;padding:20px;">
        ${inner}
      </td>
    </tr>
  </table>`;
}

// ── Schedule report email ──

export function scheduleReportEmail(data: {
  prompt: string;
  responseText: string;
  conversationUrl: string;
  scheduleName?: string;
  runCount: number;
}): { subject: string; html: string } {
  const title = data.scheduleName || data.prompt.slice(0, 60);
  const responseHtml = markdownToHtml(data.responseText.slice(0, 3000));
  const truncated = data.responseText.length > 3000;

  const content = `
    <p style="margin:0 0 4px;font-size:11px;color:${BRAND.textFaint};text-transform:uppercase;letter-spacing:0.08em;">Scheduled Report</p>
    <h2 style="margin:0 0 20px;font-size:20px;color:${BRAND.heading};font-weight:600;line-height:1.3;">${escapeHtml(title)}</h2>

    ${card(`
      <p style="margin:0 0 10px;font-size:12px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.05em;">Prompt</p>
      <p style="margin:0;color:${BRAND.text};font-size:14px;line-height:1.5;">${escapeHtml(data.prompt)}</p>
    `)}

    ${card(`
      <p style="margin:0 0 10px;font-size:12px;color:${BRAND.textMuted};text-transform:uppercase;letter-spacing:0.05em;">Response</p>
      <div style="color:${BRAND.text};font-size:14px;line-height:1.6;">
        <p style="margin:0;color:${BRAND.text};line-height:1.6;">${responseHtml}</p>
        ${truncated ? `<p style="margin:12px 0 0;color:${BRAND.textMuted};font-size:13px;font-style:italic;">Response truncated — view full conversation for the rest.</p>` : ""}
      </div>
    `)}

    ${ctaButton(data.conversationUrl, "View full conversation")}

    <p style="margin:0;font-size:12px;color:${BRAND.textFaint};text-align:center;">Run #${data.runCount}</p>`;

  return {
    subject: `Relay AI: ${title}`,
    html: baseTemplate({
      content,
      preheader: `Scheduled report: ${title}`,
      footerNote: "You're receiving this because you enabled email notifications for this schedule.",
    }),
  };
}

// ── Agent notification email ──

export function agentNotificationEmail(data: { message: string; conversationUrl: string; conversationTitle: string }): {
  subject: string;
  html: string;
} {
  const messageHtml = markdownToHtml(data.message.slice(0, 5000));

  const content = `
    <p style="margin:0 0 4px;font-size:11px;color:${BRAND.textFaint};text-transform:uppercase;letter-spacing:0.08em;">From your conversation</p>
    <h2 style="margin:0 0 20px;font-size:18px;color:${BRAND.heading};font-weight:600;line-height:1.3;">${escapeHtml(data.conversationTitle)}</h2>

    ${card(`
      <div style="color:${BRAND.text};font-size:14px;line-height:1.6;">
        <p style="margin:0;color:${BRAND.text};line-height:1.6;">${messageHtml}</p>
      </div>
    `)}

    ${ctaButton(data.conversationUrl, "View conversation")}`;

  return {
    subject: `Relay AI: ${data.conversationTitle}`,
    html: baseTemplate({
      content,
      preheader: data.message.slice(0, 100),
    }),
  };
}
