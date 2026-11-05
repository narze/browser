// Reads a fetch response body, but gives up as soon as it grows past `limit` bytes,
// so a page cannot make the main process buffer an unbounded download.
async function readLimited(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, size);
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

module.exports = { readLimited };
