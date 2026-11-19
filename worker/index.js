const COMPANY_NAME = "Tidy but Mighty Cleaning Service";
const DEFAULT_RECIPIENT_EMAIL = "tidybutmightycleaning@gmail.com";
const DEFAULT_SENDER_EMAIL = "info@jbdigitalservices.net";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCaseInsensitive(obj, key) {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) {
      return typeof v === "string" ? v : v == null ? "" : String(v);
    }
  }
  return "";
}

async function handleLeads(request, env) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  let raw;
  try {
    raw = await request.json();
  } catch (err) {
    console.warn("Invalid JSON payload on /api/leads", err);
    return new Response(null, { status: 400 });
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return new Response(null, { status: 400 });
  }

  const input = {
    companyName: getCaseInsensitive(raw, "companyName") || COMPANY_NAME,
    name: getCaseInsensitive(raw, "name"),
    phone: getCaseInsensitive(raw, "phone"),
    email: getCaseInsensitive(raw, "email"),
    preferredContactMethod: getCaseInsensitive(raw, "preferredContactMethod"),
    serviceType:
      getCaseInsensitive(raw, "serviceType") ||
      getCaseInsensitive(raw, "service"),
    preferredStartDate: getCaseInsensitive(raw, "preferredStartDate"),
    message: getCaseInsensitive(raw, "message"),
    honeypot: getCaseInsensitive(raw, "honeypot"),
  };

  // Server-side honeypot check: silently return 200 OK if filled by a bot
  if (input.honeypot.trim().length > 0) {
    return new Response(null, { status: 200 });
  }

  // Basic field validation
  if (
    !input.name.trim() ||
    !input.email.trim() ||
    !input.phone.trim() ||
    !input.message.trim()
  ) {
    return new Response("Name, Email, Phone, and Message are required.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const brevoApiKey = (env.BREVO_API_KEY || "").trim();
  if (!brevoApiKey) {
    console.error("Missing BREVO_API_KEY secret.");
    return new Response(null, { status: 500 });
  }

  const recipientEmail =
    (env.LEAD_NOTIFICATION_EMAIL || "").trim() || DEFAULT_RECIPIENT_EMAIL;
  const senderEmail =
    (env.BREVO_SENDER_EMAIL || "").trim() || DEFAULT_SENDER_EMAIL;

  const company = input.companyName.trim() || COMPANY_NAME;
  const serviceType = input.serviceType.trim() || "Cleaning Estimate";
  const contactMethod = input.preferredContactMethod.trim() || "Not specified";
  const startDate = input.preferredStartDate.trim() || "N/A";

  const htmlBody = `
    <div style='font-family:sans-serif;max-width:600px;color:#1f2937;'>
      <h2 style='color:#D81B60;border-bottom:2px solid #D81B60;padding-bottom:8px;'>
        New Website Inquiry — ${escapeHtml(company)}
      </h2>
      <table style='border-collapse:collapse;width:100%;font-size:15px;'>
        <tr><td style='padding:8px 12px;font-weight:bold;width:170px;'>Name:</td><td style='padding:8px 12px;'>${escapeHtml(input.name.trim())}</td></tr>
        <tr style='background:#fdf2f8;'><td style='padding:8px 12px;font-weight:bold;'>Phone:</td><td style='padding:8px 12px;'>${escapeHtml(input.phone.trim())}</td></tr>
        <tr><td style='padding:8px 12px;font-weight:bold;'>Email:</td><td style='padding:8px 12px;'>${escapeHtml(input.email.trim())}</td></tr>
        <tr style='background:#fdf2f8;'><td style='padding:8px 12px;font-weight:bold;'>Preferred Contact:</td><td style='padding:8px 12px;'>${escapeHtml(contactMethod)}</td></tr>
        <tr><td style='padding:8px 12px;font-weight:bold;'>Service Needed:</td><td style='padding:8px 12px;'>${escapeHtml(serviceType)}</td></tr>
        <tr style='background:#fdf2f8;'><td style='padding:8px 12px;font-weight:bold;'>Preferred Start Date:</td><td style='padding:8px 12px;'>${escapeHtml(startDate)}</td></tr>
        <tr><td style='padding:8px 12px;font-weight:bold;vertical-align:top;'>Message:</td><td style='padding:8px 12px;white-space:pre-wrap;'>${escapeHtml(input.message.trim())}</td></tr>
      </table>
      <p style='margin-top:16px;font-size:13px;color:#6b7280;'>
        Tip: Hit Reply to respond directly to ${escapeHtml(input.name.trim())} at ${escapeHtml(input.email.trim())}.
      </p>
    </div>`;

  const payload = {
    sender: { name: company, email: senderEmail },
    to: [{ email: recipientEmail, name: company }],
    replyTo: { email: input.email.trim(), name: input.name.trim() },
    subject: `New Inquiry from ${input.name.trim()} (${serviceType})`,
    htmlContent: htmlBody,
  };

  try {
    const emailResp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!emailResp.ok) {
      const errBody = await emailResp.text();
      console.error(`Brevo returned ${emailResp.status}: ${errBody}`);
      return new Response(null, { status: 502 });
    }
  } catch (err) {
    console.error("Failed to send inquiry email via Brevo.", err);
    return new Response(null, { status: 502 });
  }

  return new Response(
    JSON.stringify({ status: "saved", id: crypto.randomUUID() }),
    {
      status: 201,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (pathname === "/api/leads") {
      return handleLeads(request, env);
    }

    if (pathname.startsWith("/api/")) {
      return new Response("Not Found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
