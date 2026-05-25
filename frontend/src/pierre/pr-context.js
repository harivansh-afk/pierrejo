export function prContext(placeholder) {
  return {
    canComment: placeholder?.dataset.pierreForgejoCanComment === "1",
    isPull: placeholder?.dataset.pierreForgejoPull === "1",
    newCommentUrl: placeholder?.dataset.newCommentUrl || "",
    path: placeholder?.dataset.path || placeholder?.dataset.pierreForgejoFile || "",
  };
}

