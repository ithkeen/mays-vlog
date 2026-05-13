import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import {
  createCharacter,
  DuplicateNameError,
  EmptyNameError,
  InvalidImageError,
  type Character,
} from '../../storage/charactersDb'
import styles from './CharacterCreateForm.module.css'

/**
 * 角色创建表单。
 *
 * 设计要点：
 * - 直接调用持久层 `createCharacter`，不通过 hook 注入，保证组件可在任何上下文复用
 *   （`useCharacters` 的乐观刷新仍可用——T5 串联时父组件可在 `onCreated` 回调内自行
 *   触发列表 refresh 或合并）。
 * - 三类校验错误（`EmptyNameError` / `DuplicateNameError` / `InvalidImageError`）
 *   在表单内显示对应文案，不冒泡；其他未知错误显示通用错误文案。
 * - 选图后用 `URL.createObjectURL` 生成预览；提交成功 / 取消 / 卸载时统一 revoke，
 *   避免内存泄漏。
 * - 提交前再做一次 MIME 二次校验：`<input accept="...">` 在不同浏览器下并非强校验，
 *   用户拖入或选「显示所有文件」时可能漏掉，故在 `handleSubmit` 入口再判一次。
 * - 本组件不切抽屉态：成功时调 `onCreated(character)`，父组件决定是否回列表态；
 *   `onCancel` 同理。组件内部仅负责把自己的状态重置干净。
 */

export type CharacterCreateFormProps = {
  /** 创建成功后回调，传出刚写入 IDB 的完整 Character。 */
  onCreated: (character: Character) => void
  /** 用户点击「取消」按钮。 */
  onCancel: () => void
}

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
])

/** 把 image MIME 校验集中在一处，与持久层 `InvalidImageError` 判定口径一致。 */
function isAllowedImageMime(type: string): boolean {
  return ALLOWED_MIME_TYPES.has(type)
}

export function CharacterCreateForm({
  onCreated,
  onCancel,
}: CharacterCreateFormProps) {
  const nameId = useId()
  const instructionsId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [name, setName] = useState<string>('')
  const [instructions, setInstructions] = useState<string>('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const [nameError, setNameError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)

  // 预览 URL 生命周期：每次 imageFile 变化 → 新建一个，旧的 revoke。
  // 组件卸载时也要 revoke 当前在用的。
  useEffect(() => {
    if (imageFile === null) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [imageFile])

  const resetForm = () => {
    setName('')
    setInstructions('')
    setImageFile(null)
    setNameError(null)
    setImageError(null)
    setFormError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setImageError(null)
    setFormError(null)
    const file = e.target.files?.[0]
    if (!file) {
      setImageFile(null)
      return
    }
    if (!isAllowedImageMime(file.type)) {
      // 选了不允许的类型：拒掉并清空 input，让用户能再次选同一文件触发 change
      setImageError('图片格式必须是 PNG / JPEG / WebP')
      setImageFile(null)
      e.target.value = ''
      return
    }
    setImageFile(file)
  }

  const handleRemoveImage = () => {
    setImageFile(null)
    setImageError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleCancel = () => {
    resetForm()
    onCancel()
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isSubmitting) return

    setNameError(null)
    setImageError(null)
    setFormError(null)

    const trimmedName = name.trim()
    let hasLocalError = false
    if (trimmedName.length === 0) {
      setNameError('Name 不能为空')
      hasLocalError = true
    }
    if (imageFile === null) {
      setImageError('请先选择一张参考图')
      hasLocalError = true
    } else if (!isAllowedImageMime(imageFile.type)) {
      // submit 前的 MIME 二次校验：accept 只是建议，且用户可能拖入非法类型
      setImageError('图片格式必须是 PNG / JPEG / WebP')
      hasLocalError = true
    }
    if (hasLocalError || imageFile === null) return

    const trimmedInstructions = instructions.trim()
    setIsSubmitting(true)
    try {
      const character = await createCharacter({
        name: trimmedName,
        instructions:
          trimmedInstructions.length > 0 ? trimmedInstructions : undefined,
        image: imageFile,
      })
      // 成功：清空内部状态后通知父组件（父组件负责切回列表态）
      resetForm()
      onCreated(character)
    } catch (err) {
      if (err instanceof EmptyNameError) {
        setNameError('Name 不能为空')
      } else if (err instanceof DuplicateNameError) {
        setNameError('Name 已存在，换一个试试')
      } else if (err instanceof InvalidImageError) {
        setImageError('图片格式必须是 PNG / JPEG / WebP')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        setFormError(`创建失败：${msg}`)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <span className={styles.label}>参考图</span>
        {previewUrl !== null && imageFile !== null ? (
          <div className={styles.preview}>
            <img
              className={styles.previewImg}
              src={previewUrl}
              alt="角色参考图预览"
            />
            <div className={styles.previewMeta}>
              <span className={styles.previewName}>{imageFile.name}</span>
              <span className={styles.previewSubtle}>
                {(imageFile.size / 1024).toFixed(0)} KB · {imageFile.type}
              </span>
            </div>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={handleRemoveImage}
              disabled={isSubmitting}
            >
              移除
            </button>
          </div>
        ) : (
          <label className={styles.uploadLabel}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={styles.uploadInput}
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
            <span className={styles.uploadText}>+ 选择参考图</span>
            <span className={styles.uploadHint}>PNG / JPEG / WebP</span>
          </label>
        )}
        {imageError !== null && (
          <div className={styles.fieldError} role="alert">
            {imageError}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={nameId}>
          Name<span className={styles.required} aria-hidden="true">*</span>
        </label>
        <input
          id={nameId}
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (nameError !== null) setNameError(null)
          }}
          placeholder="给这个角色起个名字"
          disabled={isSubmitting}
          autoComplete="off"
        />
        {nameError !== null && (
          <div className={styles.fieldError} role="alert">
            {nameError}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={instructionsId}>
          Instructions
          <span className={styles.optional}>（可选）</span>
        </label>
        <textarea
          id={instructionsId}
          className={styles.textarea}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="补充对这个角色的额外说明，给未来生成做依据"
          disabled={isSubmitting}
          rows={4}
        />
      </div>

      {formError !== null && (
        <div className={styles.formError} role="alert">
          {formError}
        </div>
      )}

      <p className={styles.sizeHint}>过大图片会拖慢加载</p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          取消
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={isSubmitting}
        >
          {isSubmitting ? '创建中…' : '创建'}
        </button>
      </div>
    </form>
  )
}
