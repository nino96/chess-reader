export function LibraryEmptyState() {
  return (
    <section aria-labelledby="library-heading" data-testid="library-empty" className="panel">
      <h2 id="library-heading">Library</h2>
      <p>
        Book import is not part of this build yet — it arrives in a later part of this project. When
        it does, your books, the positions you capture, and your study data will stay on this
        device. Nothing about your library is ever uploaded anywhere.
      </p>
    </section>
  );
}
