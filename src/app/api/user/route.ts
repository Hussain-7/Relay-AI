import { requireRequestUser } from "@/lib/server-auth";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request.headers);

    return Response.json({
      user: {
        userId: user.userId,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch {
    return Response.json({ user: null }, { status: 401 });
  }
}
