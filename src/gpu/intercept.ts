/**
 * Intercepts calls to one object's method (not its prototype). The replacement is a Proxy of the
 * original function, so its own properties (e.g. test spies) stay visible. Returns a restore function.
 */
export function interceptMethod<T extends object, K extends keyof T>(
  target: T, name: K, handler: (call: (...args: unknown[]) => unknown, args: unknown[]) => unknown,
): () => void {
  const own = Object.getOwnPropertyDescriptor(target, name);
  const original = target[name] as unknown as (...args: unknown[]) => unknown;
  (target as Record<K, unknown>)[name] = new Proxy(original, {
    apply: (fn, thisArg, args: unknown[]) => handler((...callArgs) => Reflect.apply(fn, thisArg, callArgs), args),
  });
  return () => {
    if (own) Object.defineProperty(target, name, own);
    else delete (target as Partial<T>)[name];
  };
}
