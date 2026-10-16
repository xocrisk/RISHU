import type { Metadata } from "next";
import AuthExperience from "../auth-experience";

export const metadata: Metadata = { title: "Log in · XOCRISK" };

export default function LoginPage() {
  return <AuthExperience initialTab="login" />;
}