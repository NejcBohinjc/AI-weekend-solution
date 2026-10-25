// Shared Tailwind class strings, so buttons, inputs and cards look the same everywhere. The look follows the
// Global Shapers site: pill buttons in Clash Display, rounded cards with calm borders, generous spacing.
export const inputClass =
  "w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-surface-3";
export const labelClass = "text-sm font-medium text-fg-2";

const pill = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-display font-semibold transition disabled:opacity-60";
/** THE action of a page: one per page. Put <Arrow /> after the label for "go on" actions. */
export const primaryButtonClass = `${pill} bg-primary px-6 py-3 text-base text-on-primary shadow-button hover:bg-primary-hover`;
/** Other buttons: an outlined pill. */
export const secondaryButtonClass = `${pill} border border-line-strong bg-surface px-5 py-2.5 text-sm text-fg hover:bg-surface-2`;
/** A small primary button (inside a row or a form). */
export const smallButtonClass = `${pill} bg-primary px-4 py-2 text-sm text-on-primary hover:bg-primary-hover`;
/** A quiet text link-button for secondary actions. */
export const quietLinkClass = "text-sm font-medium text-muted underline-offset-4 transition hover:text-fg hover:underline";
export const dangerLinkClass = "text-sm font-medium text-danger underline-offset-4 hover:underline";

export const errorClass = "rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger";
/** A card: rounded, calm border, soft shadow. */
export const cardClass = "rounded-card border border-line bg-surface p-5 shadow-card sm:p-6";
