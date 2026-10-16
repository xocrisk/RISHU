import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = { title: "Create account | XOCRISK" };

export default function SignupPage() {
  return <AuthExperience initialTab="signup" />;
}
