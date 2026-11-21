/** Marks a part of the pipeline whose behavior is planned but not written yet. */
export interface Placeholder {
  readonly implemented: false;
}
