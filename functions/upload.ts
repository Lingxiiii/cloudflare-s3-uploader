import { S3 } from "@aws-sdk/client-s3";
import { AwsCredentialIdentity } from "@aws-sdk/types";

interface Env {
  TURNSTILE_SECRET_KEY: string;
  S3_BUCKET: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  DOWNLOAD_URL_PREFIX: string;
}

class TurnstileResponse {
  success: boolean;
  challenge_ts: string;
  hostname: string;
}

// 清理文件名中的特殊字符（Backblaze要求）
const sanitizeFilename = (name: string): string => {
  return name.replace(/[^\w\.\-]/g, '_');
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const SECRET_KEY = context.env.TURNSTILE_SECRET_KEY;
    const body = await context.request.formData();
    const token = body.get("cf-turnstile-response");
    const ip = context.request.headers.get("CF-Connecting-IP");

    // CAPTCHA验证
    const formData = new FormData();
    formData.append("secret", SECRET_KEY);
    formData.append("response", token);
    formData.append("remoteip", ip);

    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      body: formData,
      method: "POST",
    });

    const outcome: TurnstileResponse = await result.json();
    if (!outcome.success) {
      return new Response("CAPTCHA verification failed", { status: 400 });
    }

    // 文件处理
    const file = body.get("file") as File | null;
    if (!file || file.size === 0) {
      return new Response("No file uploaded", { status: 400 });
    }

    // 配置S3客户端
    const s3client = new S3({
      endpoint: context.env.S3_ENDPOINT,
      region: context.env.S3_REGION,
      credentials: {
        accessKeyId: context.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: context.env.AWS_SECRET_ACCESS_KEY,
      },
      // Backblaze特定配置
      forcePathStyle: true,  // 必须使用路径格式
    });

    // 准备上传参数
    const date = outcome.challenge_ts.split("T")[0];
    const safeFilename = sanitizeFilename(file.name);
    const objectKey = `${date}/${safeFilename}`;

    // 文件上传
    await s3client.putObject({
      Bucket: context.env.S3_BUCKET,
      Key: objectKey,
      Body: await file.arrayBuffer(),
      ContentType: file.type,
      ContentLength: file.size,
    });

    // 构建下载URL（确保路径分隔符正确）
    const baseUrl = context.env.DOWNLOAD_URL_PREFIX.replace(/\/?$/, '/');
    const downloadUrl = `${baseUrl}${objectKey}`;

    return new Response(downloadUrl);
  } catch (error) {
    console.error("Processing error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};
