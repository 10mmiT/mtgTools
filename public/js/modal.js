// ── Modal dialogs, one way ────────────────────────────────────────────────
// Every centred dialog on the page — New Deck, Change Password, the card
// detail and the rest — opens and closes through these two functions, so that
// each of them is a dialog to a keyboard and not just to an eye: the focus
// moves in when it opens, Tab cannot walk out of it onto the page behind,
// Escape closes it, and the focus goes back to whatever opened it.
//
// The FAQ note (js/faq.js) keeps its own handling and sits above all of these,
// so while it is showing this file leaves the keys to it.

/* Open dialogs, innermost last. One is usual; a second can open over the
   first, and Escape and Tab belong to the top one. */
const _modalStack = [];

const MODAL_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function _modalEl(ref) {
  return typeof ref === 'string' ? document.getElementById(ref) : ref;
}

function _modalVisible(el) {
  return !!el && el.isConnected !== false && !!el.getClientRects?.().length;
}

/* The optional calls are for the tests' stand-in elements, which are only
   as much of an element as the code under test needs. */
function _modalFocusables(overlay) {
  return [...(overlay.querySelectorAll?.(MODAL_FOCUSABLE) || [])].filter(_modalVisible);
}

/* Show `ref` (an element or its id) as a modal dialog. Its markup says it is
 * one — role="dialog", aria-modal and a label — this makes it behave as one.
 *   onClose     — what Escape does; the dialog's own Cancel, which may need
 *                 to do more than hide it. Defaults to closeModal(ref).
 *   focus       — the element (or id) to start on. Defaults to the first
 *                 control in it, then the dialog itself.
 *   returnFocus — where focus goes on close, when it is not where it is now
 *                 (one dialog handing over to another). */
function openModal(ref, opts = {}) {
  const overlay = _modalEl(ref);
  if (!overlay) return;
  const open = _modalStack.find(m => m.overlay === overlay);
  if (open) { if (opts.onClose) open.onClose = opts.onClose; return; }

  overlay.style.display = 'flex';
  _modalStack.push({
    overlay,
    onClose: opts.onClose || null,
    returnFocus: opts.returnFocus || document.activeElement,
  });

  const start = _modalEl(opts.focus) || _modalFocusables(overlay)[0];
  if (start) { start.focus?.(); return; }
  const box = overlay.querySelector?.('.card-modal-box') || overlay;
  if (!box.hasAttribute?.('tabindex')) box.setAttribute?.('tabindex', '-1');
  box.focus?.();
}

/* Hide `ref` and give the focus back to what opened it, if that is still on
   the page to receive it. Returns that element, for a dialog that hands the
   same way back on to the next one. Closing one that is not open is safe. */
function closeModal(ref) {
  const overlay = _modalEl(ref);
  if (!overlay) return null;
  overlay.style.display = 'none';
  const i = _modalStack.findIndex(m => m.overlay === overlay);
  if (i < 0) return null;
  const [{ returnFocus }] = _modalStack.splice(i, 1);
  if (_modalVisible(returnFocus)) returnFocus.focus?.();
  return returnFocus || null;
}

function modalIsOpen() { return _modalStack.length > 0; }

document.addEventListener('keydown', e => {
  const top = _modalStack[_modalStack.length - 1];
  if (!top) return;
  if (typeof faqIsOpen === 'function' && faqIsOpen()) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    /* Registered before js/main.js's own Escape handler, which would also
       close whatever drawer is behind the dialog. One press, one thing. */
    e.stopImmediatePropagation();
    if (top.onClose) top.onClose(); else closeModal(top.overlay);
    return;
  }

  if (e.key !== 'Tab') return;
  const items = _modalFocusables(top.overlay);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const inside = top.overlay.contains(document.activeElement);
  if (!inside || (e.shiftKey && document.activeElement === first)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
