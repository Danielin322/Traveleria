import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * React Native 0.86 widened `ColorSchemeName` to `'light' | 'dark' | 'unspecified'`.
 * Nothing in the app has a meaningful "unspecified" rendering, and every consumer
 * indexes a `{ light, dark }` pair, so collapse it to the two real cases here
 * rather than re-deriving a default at each call site.
 */
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
