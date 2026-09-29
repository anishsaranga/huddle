/** Chat tab stand-in until group chat ships (T7.1 replaces this slot). */
export function ChatPlaceholder() {
  return (
    <div className="px-4 pb-6 pt-10">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-6 grid size-20 place-items-center rounded-full bg-white/[0.04] shadow-[inset_0_0_0_1px_var(--hairline-strong)]">
          <svg aria-hidden width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-2">
            <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.4c-.5.4-1.3 0-1.3-.6V16.9A2.5 2.5 0 0 1 4 15.5z" />
            <path d="M8.5 9.2h7M8.5 12.2h4" />
          </svg>
          <span aria-hidden className="absolute -inset-3 rounded-full border border-dashed border-hairline" />
        </div>
        <p className="label mb-2">Chat is coming soon</p>
        <p className="max-w-[30ch] text-[15px] leading-relaxed text-muted">
          Banter, reactions and the daily champions post will live here.
        </p>
      </div>
    </div>
  );
}
