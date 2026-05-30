import { confirmSignUp, deleteUser, signIn, signOut, signUp } from "aws-amplify/auth";

interface SignUpParams {
  email: string;
  password: string;
  firstName: string;
}

export const registerUser = async ({ email, password, firstName }: SignUpParams) => {
  try {
    const { isSignUpComplete, userId } = await signUp({
      username: email,
      password,
      options: { userAttributes: { email, given_name: firstName } },
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
