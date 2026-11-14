export async function* readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const newline = done ? /\r\n|\r|\n/g : /\r\n|\r(?!$)|\n/g;
      let start = 0;
      for (const match of buffer.matchAll(newline)) {
        const line = buffer.slice(start, match.index);
        start = match.index + match[0].length;
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          event = '';
          data = [];
          continue;
        }
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        const content = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
        if (field === 'event') event = content;
        if (field === 'data') data.push(content);
      }
      if (done) return;
      buffer = buffer.slice(start);
      if (buffer.length > 128_000) throw new Error('Сервер прислал слишком длинное событие.');
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
