// Import the authentication functions from AWS Amplify
import { confirmSignUp, signIn, signOut, signUp } from "aws-amplify/auth";

// Interface defining the expected parameters for user registration
interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
}

// Function to handle the registration of a new user
export const registerUser = async ({
  email,
  password,
  firstName,
}: SignUpParams) => {
  try {
    // Send the registration request to AWS Cognito
    const { isSignUpComplete, userId } = await signUp({
      username: email,
      password: password,
      options: {
        userAttributes: {
          email: email,
          given_name: firstName,
        },
      },
    });

    // Log the successful registration
    console.log("Registration successful, user ID:", userId);

    // Return success status so the UI can proceed
    return { success: true, isSignUpComplete, userId };
  } catch (error) {
    // Log the error if registration fails
    console.error("Error during sign up:", error);

    // Return failure status and the error message to the UI
    return { success: false, error };
  }
};

export const confirmUser = async (email: string, code: string) => {
  try {
    // Send the confirmation code to AWS Cognito
    const { isSignUpComplete } = await confirmSignUp({
      username: email,
      confirmationCode: code,
    });

    // Return success status
    return { success: true, isSignUpComplete };
  } catch (error) {
    // Log error if verification fails
    console.error("Error confirming sign up:", error);
    return { success: false, error };
  }
};

// Function to authenticate a user with email and password
export const signInUser = async (email: string, pass: string) => {
  try {
    // Attempting to sign in via AWS Amplify
    const { isSignedIn, nextStep } = await signIn({
      username: email,
      password: pass,
      options: {
        authFlowType: "USER_PASSWORD_AUTH",
      },
    });

    // Returning the result to the UI
    return { success: true, isSignedIn, nextStep };
  } catch (error) {
    const err = error as any;

    console.log("--- FULL AUTH ERROR START ---");
    // Converting the object to a readable string
    console.log(JSON.stringify(err, null, 2));
    console.log("Error Name:", err.name);
    console.log("Error Message:", err.message);

    if (err.underlyingError) {
      console.log(
        "Underlying Error:",
        JSON.stringify(err.underlyingError, null, 2),
      );
    }
    console.log("--- FULL AUTH ERROR END ---");
    return { success: false, error };
  }
};

export const signOutUser = async () => {
  try {
    await signOut();
    return { success: true };
  } catch (error) {
    console.error("Error signing out:", error);
    return { success: false, error };
  }
};
