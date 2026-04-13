// Exporting the configuration object for AWS Amplify
const awsConfig = {
  Auth: {
    Cognito: {
      // The region where the user pool was created
      region: "us-east-1",

      // The unique identifier for the user pool
      userPoolId: "us-east-1_hxHdB32mE",

      // The ID of the app client that accesses the user pool
      userPoolClientId: "34stji8pnkourf7ficq7prt0a0",
    },
  },
};

export default awsConfig;
