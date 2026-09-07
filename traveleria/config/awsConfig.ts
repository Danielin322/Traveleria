const awsConfig = {
  Auth: {
    Cognito: {
      region: process.env.EXPO_PUBLIC_COGNITO_REGION!,
      userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID!,
      userPoolClientId: process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_ID!,
    },
  },
};

export default awsConfig;
