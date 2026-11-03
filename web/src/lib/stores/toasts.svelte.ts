export interface Toast {
  id: number;
  kind: 'positive' | 'negative';
  title: string;
  body?: string;
}

class Toasts {
  items = $state<Toast[]>([]);
  #n = 0;

  push(kind: Toast['kind'], title: string, body?: string) {
    const id = ++this.#n;
    this.items.push({ id, kind, title, body });
    if (kind === 'positive') setTimeout(() => this.dismiss(id), 6000);
  }

  dismiss(id: number) {
    this.items = this.items.filter((t) => t.id !== id);
  }
}

export const toasts = new Toasts();
