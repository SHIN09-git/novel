// Compatibility facade for existing imports. Runtime callers lazy-load the focused
// generation/version modules directly so unrelated dependencies stay out of each path.
export * from './revisionStudioActionTypes'
export * from './revisionGenerationActions'
export * from './revisionRequestRelocationActions'
export * from './revisionVersionActions'
