/** Rednote card dialog of /photography/: opens from its button, closes on a backdrop click, returns focus. */
const openButton = document.querySelector('[data-rednote-open]');
const dialog = document.querySelector('[data-rednote-dialog]');

if (openButton instanceof HTMLButtonElement && dialog instanceof HTMLDialogElement) {
  openButton.addEventListener('click', () => dialog.showModal());

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('close', () => openButton.focus());
}
