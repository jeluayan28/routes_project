type Callback = ResizeObserverCallback;

/** Test double: records observers so a test can fire a resize on demand. */
export class FakeResizeObserver {
  static instances = new Set<FakeResizeObserver>();
  constructor(private callback: Callback) {}
  observe() {
    FakeResizeObserver.instances.add(this);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.instances.delete(this);
  }
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
  static triggerAll() {
    for (const o of [...FakeResizeObserver.instances]) o.trigger();
  }
}
