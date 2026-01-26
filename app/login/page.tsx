"use client";
import { loginUser } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();

  const demoLogin = async (email: string) => {
    const res = await loginUser({ email, password: "123456" });
    localStorage.setItem("token", res.data.accessToken);
    router.push("/chat");
  };

  return (
    <div className="flex h-screen justify-center items-center bg-gray-100">
      <div className="p-8 bg-white shadow rounded w-96 text-center">
        <h2 className="text-xl mb-6 font-semibold">Demo Login</h2>

        <button
          className="w-full mb-4 bg-blue-600 text-white py-2 rounded"
          onClick={() => demoLogin("demo1@test.com")}
        >
          Login as Demo User A
        </button>

        <button
          className="w-full bg-green-600 text-white py-2 rounded"
          onClick={() => demoLogin("demo2@test.com")}
        >
          Login as Demo User B
        </button>
      </div>
    </div>
  );
}
