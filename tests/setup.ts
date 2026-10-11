// Global Jest setup.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
// expo-crypto is native; use Node's UUID generator in tests.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
