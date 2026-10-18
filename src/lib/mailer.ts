/**
 * Email transport.
 * If SMTP_* env vars are configured, nodemailer is loaded dynamically;
 * otherwise the message is logged to the server console (dev / preview mode).
 */
type MailInput = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: MailInput) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
     
    console.info(`[mail:dev] message not delivered to=${to} subject="${subject}"`);
    return { delivered: false as const };
  }

  try {
    // nodemailer is loaded lazily so the package stays optional in the sandbox.
    const specifier = "nodemailer";
    const mod = (await import(specifier).catch(() => null)) as {
      createTransport?: (opts: Record<string, unknown>) => {
        sendMail: (opts: Record<string, unknown>) => Promise<unknown>;
      };
    } | null;
    if (!mod?.createTransport) {
       
      console.info(`[mail:fallback] message not delivered to=${to} subject="${subject}"`);
      return { delivered: false as const };
    }
    const transporter = mod.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user, pass },
    });
    await transporter.sendMail({ from: `"SMM Panel" <${user}>`, to, subject, html });
    return { delivered: true as const };
  } catch (error) {
     
    console.error("[mail:error]", error);
    return { delivered: false as const };
  }
}

export function resetPasswordEmail(name: string, link: string) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;background:#0f172a;padding:32px;color:#f8fafc">
    <h2 style="color:#3b82f6;margin:0 0 12px">Reset your password</h2>
    <p>Hi ${name}, we received a request to reset your SMM Panel password.</p>
    <p><a href="${link}" style="background:#3b82f6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p>
    <p style="color:#94a3b8;font-size:13px">This link expires in 60 minutes. If you didn't request it, ignore this email.</p>
  </div>`;
}

export function verifyEmailEmail(name: string, link: string) {
  return `
  <div style="font-family:Inter,Arial,sans-serif;background:#0f172a;padding:32px;color:#f8fafc">
    <h2 style="color:#3b82f6;margin:0 0 12px">Verify your email</h2>
    <p>Hi ${name}, welcome to SMM Panel! Please confirm your email address to unlock ordering and wallet top-ups.</p>
    <p><a href="${link}" style="background:#3b82f6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Verify email</a></p>
    <p style="color:#94a3b8;font-size:13px">If you didn't create this account, you can safely ignore this email.</p>
  </div>`;
}
