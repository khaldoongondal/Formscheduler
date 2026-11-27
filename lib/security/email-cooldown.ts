/** Pure helpers for the per-address email send cooldown. */

export type EmailSendReservation = {
  allowed: boolean;
  /** Gives the slot back, so a failed send does not start the cooldown. */
  release: () => Promise<void>;
};

export type CooldownSendResult = "sent" | "cooldown" | "skipped";

/**
 * Takes a cooldown slot, runs the send, and gives the slot back when the send
 * throws or decides there was nothing to send. Only a real send keeps the slot.
 * Errors from the send are rethrown after the release.
 */
export async function sendWithEmailCooldown(
  reserve: () => Promise<EmailSendReservation>,
  send: () => Promise<boolean>
): Promise<CooldownSendResult> {
  const reservation = await reserve();
  if (!reservation.allowed) return "cooldown";

  let sent: boolean;
  try {
    sent = await send();
  } catch (error) {
    await reservation.release().catch(() => undefined);
    throw error;
  }

  if (!sent) {
    await reservation.release().catch(() => undefined);
    return "skipped";
  }
  return "sent";
}
