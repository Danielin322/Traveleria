import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A seconds counter that ticks down to zero and stops.
 *
 * Used to hold the "Resend code" button closed for a moment after a code is
 * sent, so it is not tapped reflexively while the first email is still in
 * flight — which would both waste a send and count against Cognito's throttle.
 *
 * Starts idle at zero; call `start` to run it.
 */
export function useCountdown(seconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  const start = useCallback(() => {
    clear();
    setSecondsLeft(seconds);
    timer.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clear();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [seconds]);

  // A timer left running past unmount would set state on a dead component.
  useEffect(() => clear, []);

  return { secondsLeft, start };
}
