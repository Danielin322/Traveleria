import {
  confirmSignUp,
  deleteUser,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
} from "aws-amplify/auth";

interface SignUpParams {
  email: string;
  password: string;
}

/**
 * Signs the user up with email and password only.
 *
 * given_name used to be collected here, but nothing ever read it: auth.py
 * stores only email and cognito_sub, and the profile's display name is typed
 * separately in Edit Profile. The pool does not require the attribute.
 */
export const registerUser = async ({ email, password }: SignUpParams) => {
  try {
    const { isSignUpComplete, userId } = await signUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
    return { success: true, isSignUpComplete, userId };
  } catch (error) {
    return { success: false, error };
  }
};

export const confirmUser = async (email: string, code: string) => {
  try {
    const { isSignUpComplete } = await confirmSignUp({ username: email, confirmationCode: code });
    return { success: true, isSignUpComplete };
  } catch (error) {
    return { success: false, error };
  }
};

/**
 * Sends a fresh confirmation code to a signed-up but unverified account.
 *
 * Wraps Cognito's ResendConfirmationCode, which every user pool app client
 * exposes by default — no pool configuration is involved. Note that Cognito
 * invalidates the previous code, so an older email stops working.
 */
export const resendVerificationCode = async (email: string) => {
  try {
    const { destination } = await resendSignUpCode({ username: email });
    return { success: true, destination };
  } catch (error) {
    return { success: false, error };
  }
};

export const signInUser = async (email: string, pass: string) => {
  try {
    const { isSignedIn, nextStep } = await signIn({
      username: email,
      password: pass,
      options: { authFlowType: "USER_PASSWORD_AUTH" },
    });
    return { success: true, isSignedIn, nextStep };
  } catch (error) {
    return { success: false, error };
  }
};

export const signOutUser = async () => {
  try {
    await signOut({ global: true });
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
};

export const deleteUserAccount = async () => {
  try {
    await deleteUser();
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
};
