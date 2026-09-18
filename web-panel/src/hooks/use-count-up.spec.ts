import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountUp } from './use-count-up';

describe('useCountUp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at 0 and reaches the target value after the full duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(1000, 300));

    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(1000);
  });

  it('jumps straight to 0 when the target is 0', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(0, 300));

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current).toBe(0);
  });
});
