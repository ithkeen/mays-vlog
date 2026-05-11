import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import styles from './PromptInput.module.css';

/** 校验上限：与 REQUIREMENT「图片 ≤10MB」对齐。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 落入 IndexedDB 与 data URL 的 MIME；jpg / jpeg 统一规范化为 image/jpeg。 */
type AllowedMime = 'image/png' | 'image/jpeg';

/**
 * 提交表单时父级拿到的载荷。
 * - prompt 已 trim，非空才会派发。
 * - imageBase64 是 raw base64（已剥掉 `data:image/...;base64,` 前缀）。
 * - imageMimeType 与 imageBase64 同时为非 null，或同时为 null。
 */
export type PromptInputSubmitPayload = {
  prompt: string;
  imageBase64: string | null;
  imageMimeType: AllowedMime | null;
};

export type PromptInputProps = {
  onSubmit: (payload: PromptInputSubmitPayload) => void;
  /** 提交期间锁定整个输入区与按钮。 */
  disabled: boolean;
  /** 主按钮文案，例如 idle 时 "生成视频"、运行中 "生成中…"。 */
  submitLabel: string;
};

/** FileReader 把文件转成完整 data URL，再切掉前缀只留 raw base64。 */
function readFileAsRawBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader 读取失败'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader 返回非字符串'));
        return;
      }
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('data URL 缺少分隔符'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 把浏览器 file.type 归一化到我们要存的 MIME：
 * - image/png 原样
 * - image/jpeg 与 image/jpg 都归到 image/jpeg（PLAN T11 中允许放宽兼容 image/jpg）
 * 其它一律返回 null（拒收）。
 */
function normalizeMime(raw: string): AllowedMime | null {
  if (raw === 'image/png') return 'image/png';
  if (raw === 'image/jpeg' || raw === 'image/jpg') return 'image/jpeg';
  return null;
}

export function PromptInput({
  onSubmit,
  disabled,
  submitLabel,
}: PromptInputProps) {
  const promptId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<AllowedMime | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    setImageError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const mime = normalizeMime(file.type);
    if (mime === null) {
      setImageError('仅支持 PNG / JPEG 格式');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(
        `图片超过 10MB（实际 ${(file.size / 1024 / 1024).toFixed(1)}MB）`,
      );
      e.target.value = '';
      return;
    }

    try {
      const base64 = await readFileAsRawBase64(file);
      setImageBase64(base64);
      setImageMimeType(mime);
      setImageFileName(file.name);
    } catch (err) {
      setImageError(
        `读取文件失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleRemoveImage = () => {
    setImageBase64(null);
    setImageMimeType(null);
    setImageFileName(null);
    setImageError(null);
    // 清空 input.value，确保用户能再次选同一文件触发 change
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const trimmed = prompt.trim();
  const submitDisabled = disabled || trimmed.length === 0;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitDisabled) return;
    onSubmit({
      prompt: trimmed,
      imageBase64,
      imageMimeType,
    });
  };

  const hasImage = imageBase64 !== null && imageMimeType !== null;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <label className={styles.label} htmlFor={promptId}>
        视频描述
      </label>
      <textarea
        id={promptId}
        className={styles.textarea}
        placeholder="描述你想生成的视频画面…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={disabled}
        rows={5}
        maxLength={2500}
      />
      <div className={styles.charCount}>{prompt.length} / 2500</div>

      <div className={styles.imageRow}>
        {hasImage ? (
          <div className={styles.preview}>
            <img
              className={styles.previewImg}
              src={`data:${imageMimeType};base64,${imageBase64}`}
              alt="首帧预览"
            />
            <div className={styles.previewMeta}>
              <span className={styles.previewName}>
                {imageFileName ?? '已选首帧图'}
              </span>
              <span className={styles.previewSubtle}>
                将作为生成视频的第一帧
              </span>
            </div>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={handleRemoveImage}
              disabled={disabled}
            >
              移除
            </button>
          </div>
        ) : (
          <label className={styles.uploadLabel}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className={styles.uploadInput}
              onChange={handleFileChange}
              disabled={disabled}
            />
            <span className={styles.uploadText}>+ 添加首帧参考图（可选）</span>
            <span className={styles.uploadHint}>PNG / JPEG，≤10MB</span>
          </label>
        )}
      </div>

      {imageError !== null && (
        <div className={styles.imageError} role="alert">
          {imageError}
        </div>
      )}

      <button type="submit" className={styles.submit} disabled={submitDisabled}>
        {submitLabel}
      </button>
    </form>
  );
}
