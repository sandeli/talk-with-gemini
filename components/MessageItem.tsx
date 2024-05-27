import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import MarkdownIt from 'markdown-it'
import markdownHighlight from 'markdown-it-highlightjs'
import highlight from 'highlight.js'
import markdownKatex from '@traptitech/markdown-it-katex'
import Clipboard from 'clipboard'
import { useTranslation } from 'react-i18next'
import { User, Bot, RotateCw, Sparkles, Copy, CopyCheck, PencilLine, Eraser, Volume2 } from 'lucide-react'
import { EdgeSpeech } from '@xiangfa/polly'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import BubblesLoading from '@/components/BubblesLoading'
import FileList from '@/components/FileList'
import EditableArea from '@/components/EditableArea'
import IconButton from '@/components/IconButton'
import { useMessageStore } from '@/store/chat'
import { useSettingStore } from '@/store/setting'
import AudioStream from '@/utils/AudioStream'
import { sentenceSegmentation } from '@/utils/common'
import { upperFirst, isFunction, find } from 'lodash-es'

interface Props extends Message {
  onRegenerate?: (id: string) => void
}

const registerCopy = (className: string) => {
  const clipboard = new Clipboard(className, {
    text: (trigger) => {
      return decodeURIComponent(trigger.getAttribute('data-clipboard-text') || '')
    },
  })
  return clipboard
}

function filterMarkdown(text: string): string {
  const md = new MarkdownIt()
  // Convert Markdown to HTML using markdown-it
  const html = md.render(text)
  // Convert HTML to DOM objects using DOMParser
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  // Get filtered text content
  const filteredText = doc.body.textContent || ''
  return filteredText
}

function mergeSentences(sentences: string[], sentenceLength = 20): string[] {
  const mergedSentences: string[] = []
  let currentSentence = ''

  sentences.forEach((sentence) => {
    if (currentSentence.length + sentence.length >= sentenceLength) {
      mergedSentences.push(currentSentence.trim())
      currentSentence = sentence
    } else {
      currentSentence += ' ' + sentence
    }
  })

  if (currentSentence.trim() !== '') {
    mergedSentences.push(currentSentence.trim())
  }
  return mergedSentences
}

function MessageItem({ id, role, parts, attachments, onRegenerate }: Props) {
  const { t } = useTranslation()
  const [html, setHtml] = useState<string>('')
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [isCopyed, setIsCopyed] = useState<boolean>(false)
  const fileList = useMemo(() => {
    return attachments ? attachments.filter((item) => !item.metadata?.mimeType.startsWith('image/')) : []
  }, [attachments])
  const content = useMemo(() => {
    let text = ''
    parts.forEach((item) => {
      if (item.text) text = item.text
    })
    return text
  }, [parts])

  const handleRegenerate = useCallback(
    (id: string) => {
      if (isFunction(onRegenerate)) {
        onRegenerate(id)
      }
    },
    [onRegenerate],
  )

  const handleEdit = useCallback((id: string, content: string) => {
    const { messages, update, save } = useMessageStore.getState()
    const message = find(messages, { id })

    if (message) {
      const messageParts = [...message.parts]
      messageParts.map((part) => {
        if (part.text) part.text = content
      })
      update(id, { ...message, parts: messageParts })
      save()
    }

    setIsEditing(false)
  }, [])

  const handleDelete = useCallback((id: string) => {
    const { remove } = useMessageStore.getState()
    remove(id)
  }, [])

  const handleCopy = useCallback(() => {
    setIsCopyed(true)
    setTimeout(() => {
      setIsCopyed(false)
    }, 2000)
  }, [])

  const handleSpeak = useCallback(async () => {
    const { lang, ttsLang, ttsVoice } = useSettingStore.getState()
    const sentences = mergeSentences(sentenceSegmentation(filterMarkdown(content), lang), 100)
    const edgeSpeech = new EdgeSpeech({ locale: ttsLang })
    const audioStream = new AudioStream()

    for (const sentence of sentences) {
      const response = await edgeSpeech.create({
        input: sentence,
        options: { voice: ttsVoice },
      })
      if (response) {
        const audioData = await response.arrayBuffer()
        audioStream.play({ audioData })
      }
    }
  }, [content])

  const render = useCallback(
    (content: string) => {
      const md: MarkdownIt = MarkdownIt({
        linkify: true,
        breaks: true,
      })
        .use(markdownHighlight)
        .use(markdownKatex)

      const mathLineRender = md.renderer.rules.math_inline!
      md.renderer.rules.math_inline = (...params) => {
        const [tokens, idx] = params
        const token = tokens[idx]
        return `
          <div class="katex-inline-warpper">
            <span class="copy copy-katex-inline" data-clipboard-text="${encodeURIComponent(token.content)}">${t(
              'copy',
            )}</span>
            ${mathLineRender(...params)}
          </div>
        `
      }
      const mathBlockRender = md.renderer.rules.math_block!
      md.renderer.rules.math_block = (...params) => {
        const [tokens, idx] = params
        const token = tokens[idx]
        return `
          <div class="katex-block-warpper">
            <span class="copy copy-katex-block" data-clipboard-text="${encodeURIComponent(token.content)}">${t(
              'copy',
            )}</span>
            ${mathBlockRender(...params)}
          </div>
        `
      }
      const highlightRender = md.renderer.rules.fence!
      md.renderer.rules.fence = (...params) => {
        const [tokens, idx] = params
        const token = tokens[idx]
        const lang = token.info.trim()
        return `
          <div class="hljs-warpper">
            <div class="info">
              <span class="lang">${upperFirst(lang)}</span>
              <span class="copy copy-code" data-clipboard-text="${encodeURIComponent(token.content)}">${t(
                'copy',
              )}</span>
            </div>
            ${highlight.getLanguage(lang) ? highlightRender(...params) : null}
          </div>
        `
      }
      return md.render(content)
    },
    [t],
  )

  useEffect(() => {
    const messageParts: string[] = []
    parts.forEach(async (part) => {
      if (part.text) {
        messageParts.push(render(part.text))
      } else if (part.inlineData?.mimeType.startsWith('image/')) {
        messageParts.push(
          `<img class="inline-image" alt="inline-image" src="data:${part.inlineData.mimeType};base64,${part.inlineData.data}" />`,
        )
      } else if (part.fileData && attachments) {
        for (const attachment of attachments) {
          if (attachment.metadata?.uri === part.fileData.fileUri) {
            if (part.fileData?.mimeType.startsWith('image/')) {
              messageParts.push(`<img class="inline-image" alt="inline-image" src="${attachment.preview}" />`)
            }
          }
        }
      }
    })
    setHtml(messageParts.join(''))
    const copyKatexInline = registerCopy('.copy-katex-inline')
    const copyKatexBlock = registerCopy('.copy-katex-block')
    const copyCode = registerCopy('.copy-code')

    const copyContent = new Clipboard(`.copy-${id}`, {
      text: () => content,
    })
    return () => {
      setHtml('')
      copyKatexInline.destroy()
      copyKatexBlock.destroy()
      copyCode.destroy()
      copyContent.destroy()
    }
  }, [id, content, parts, attachments, render])

  return (
    <>
      <Avatar className="h-8 w-8">
        {role === 'user' ? (
          <AvatarFallback className="bg-green-300 text-white">
            <User />
          </AvatarFallback>
        ) : (
          <AvatarFallback className="bg-red-300 text-white">
            <Bot />
          </AvatarFallback>
        )}
      </Avatar>
      {role === 'model' && parts && parts[0].text === '' ? (
        <BubblesLoading />
      ) : (
        <div className="group relative flex-auto">
          {fileList.length > 0 ? (
            <div className="w-full border-b border-dashed pb-2">
              <FileList fileList={fileList} />
            </div>
          ) : null}
          {!isEditing ? (
            <>
              <div
                className="prose w-full overflow-hidden break-words pb-3 text-base leading-8"
                dangerouslySetInnerHTML={{ __html: html }}
              ></div>
              <div className="absolute -bottom-3 right-0 flex gap-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                {id !== 'preview' ? (
                  <>
                    <IconButton
                      title={t(role === 'user' ? 'resend' : 'regenerate')}
                      onClick={() => handleRegenerate(id)}
                    >
                      {role === 'user' ? <RotateCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    </IconButton>
                    <IconButton title={t('edit')} onClick={() => setIsEditing(true)}>
                      <PencilLine className="h-4 w-4" />
                    </IconButton>
                    <IconButton title={t('delete')} onClick={() => handleDelete(id)}>
                      <Eraser className="h-4 w-4" />
                    </IconButton>
                  </>
                ) : null}
                <IconButton title={t('copy')} className={`copy-${id}`} onClick={() => handleCopy()}>
                  {isCopyed ? <CopyCheck className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </IconButton>
                <IconButton title={t('speak')} onClick={() => handleSpeak()}>
                  <Volume2 className="h-4 w-4" />
                </IconButton>
              </div>
            </>
          ) : (
            <EditableArea
              content={content}
              isEditing={isEditing}
              onChange={(content) => handleEdit(id, content)}
              onCancel={() => setIsEditing(false)}
            />
          )}
        </div>
      )}
    </>
  )
}

export default memo(MessageItem)
