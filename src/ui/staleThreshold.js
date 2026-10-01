// The toolbar's "Stale after N days" control (see store.js's isStale /
// setStaleThresholdDays). Lives in the toolbar itself, not the hamburger
// menu -- it's a live, frequently-adjusted control, same reasoning as
// mountMiniProgressBar in ui/progress.js.

export function mountStaleThresholdControl(container, input, store) {
  input.value = String(store.staleThresholdDays);
  input.addEventListener("change", () => {
    try {
      store.setStaleThresholdDays(input.value);
    } catch (err) {
      window.alert(err.message);
      input.value = String(store.staleThresholdDays); // revert display on a rejected value
    }
  });
  container.hidden = false;
}
