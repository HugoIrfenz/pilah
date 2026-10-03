export function RetentionList() {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[12.5px] leading-5 text-mute">
    <li>PILAH keeps at most 50 recent messages per selected chat, for up to 7 days.</li>
    <li>Attachments are not downloaded or interpreted. Unsupported-content metadata can remain for review. Disappearing and view-once content is excluded.</li>
    <li>Ranking is rules-based and runs on this server. No AI provider is used.</li>
  </ul>;
}
export function LinkNotice({ ack, setAck }: { ack: boolean; setAck: (value: boolean) => void }) {
  return <div className="w-full rounded-xl border border-[#ecd9a8] bg-[#fbf4df] p-4 text-[12.5px] leading-5 text-[#5f4a14]" data-testid="notice-link">
    <p className="font-semibold">Before you link</p>
    <ul className="mt-2 list-disc space-y-1.5 pl-5">
      <li>Linking works as a WhatsApp linked device. WhatsApp does not limit a linked device to the chats you select, so PILAH's connection can technically receive all your chats. PILAH only analyzes the chats you choose.</li>
      <li>This uses an unofficial connection. It is not approved by or affiliated with WhatsApp or Meta, and your account could be restricted.</li>
      <li>Use a dedicated test account or number, not your primary one.</li>
      <li>PILAH never sends messages or read receipts.</li>
    </ul>
    <RetentionList />
    <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 font-semibold"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} className="mt-1 h-4 w-4 accent-[#0a5c4a]" data-testid="checkbox-link-ack" />I understand these limits and want to link a WhatsApp account.</label>
  </div>;
}
