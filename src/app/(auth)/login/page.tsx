import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { Skeleton } from "@/components/ui";

export const metadata = { title: "Sign in — SMM Panel" };

export default function LoginPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LoginForm />
    </Suspense>
  );
}
