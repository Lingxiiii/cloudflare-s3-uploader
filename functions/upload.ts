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

const sanitizeFilename = (name: string): string => {
  return name.replace(/[^\w\.\-]/g, '_');
};

function getReturnPage(statuscode: number, title: string, message: string): Response {
var htmltemplate= `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件共享</title>
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    <style>
        :root {
            --primary: #4a6cf7;
            --primary-dark: #3a56d8;
            --secondary: #6c757d;
            --success: #28a745;
            --light: #f8f9fa;
            --dark: #212529;
            --shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
            --transition: all 0.3s ease;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            color: var(--dark);
            line-height: 1.6;
        }
        
        .container {
            max-width: 800px;
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 30px;
        }
        
        header {
            text-align: center;
            padding: 20px;
        }
        
        header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            color: var(--primary);
            text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        header p {
            font-size: 1.1rem;
            color: var(--secondary);
            max-width: 600px;
            margin: 0 auto;
        }
        
        .card {
            background: white;
            border-radius: 16px;
            box-shadow: var(--shadow);
            overflow: hidden;
            transition: var(--transition);
        }
        
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
        }
        
        .card-header {
            background: var(--primary);
            color: white;
            padding: 20px 30px;
            font-size: 1.5rem;
            font-weight: 600;
        }
        
        .card-body {
            padding: 30px;
        }
        
        .download-link {
            margin: 25px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
            text-align: center;
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        
        .feature {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: var(--shadow);
            text-align: center;
            transition: var(--transition);
        }
        
        .feature:hover {
            transform: translateY(-5px);
        }
        
        .feature i {
            font-size: 2.5rem;
            color: var(--primary);
            margin-bottom: 15px;
            display: block;
        }
        
        .feature h3 {
            margin-bottom: 10px;
            color: var(--primary);
        }
        
        .feature p {
            color: var(--secondary);
        }
        
        @media (max-width: 600px) {
            .container {
                gap: 20px;
            }
            
            header h1 {
                font-size: 2rem;
            }
            
            .card-body {
                padding: 20px;
            }
            
            .features {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>安全文件共享</h1>
            <p>使用Cloudflare Turnstile保护上传操作，防止机器人滥用</p>
        </header>
        
        <div class="card">
            <div class="card-header">
                ${title}
            </div>
            <div class="card-body">
                下载链接
                <div class="download-link">
                    <p>${message}</p>
                </div>
            </div>
        </div>
        
        <div class="features">
            <div class="feature">
                <i>🔒</i>
                <h3>安全验证</h3>
                <p>Cloudflare Turnstile保护上传免受机器人攻击</p>
            </div>
            <div class="feature">
                <i>⚡</i>
                <h3>快速上传</h3>
                <p>利用全球CDN实现高速文件传输</p>
            </div>
            <div class="feature">
                <i>📤</i>
                <h3>简单分享</h3>
                <p>上传后获取直接下载链接</p>
            </div>
        </div>
    </div>
</body>
</html>`
  return new Response(htmltemplate, {
    status: statuscode,
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

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
      return getReturnPage(400, "验证失败", "CAPTCHA验证失败，请重试。");
    }

    // 文件处理
    const file = body.get("file") as File | null;
    if (!file || file.size === 0) {
      return getReturnPage(400, "文件上传失败", "未检测到文件，请重新上传。");
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
    return getReturnPage(200, "文件上传成功", `您的文件已成功上传。<br>下载链接：<a href="${downloadUrl}" target="_blank">${downloadUrl}</a>`);
  } catch (error) {
    console.error("Processing error:", error);
    return getReturnPage(500, "服务器错误", "处理请求时发生错误，请稍后再试。");
  }
};
