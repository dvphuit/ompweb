import type { AssistantContentBlock, AssistantMessage, ThinkingContent, ToolCallContent } from "./types";

export function isEmptyThinkingBlock(block: AssistantContentBlock): block is ThinkingContent {
  return block.type === "thinking" && !block.deferred && block.thinking.trim() === "";
}

export function getDisplayableAssistantBlocks(message: AssistantMessage): AssistantContentBlock[] {
  return (message.content ?? []).filter((block) => !isEmptyThinkingBlock(block));
}

function isFinalAnswerBlock(block: AssistantContentBlock): boolean {
  return block.type === "text" || block.type === "image";
}

export function splitFinalAssistantBlocks(message: AssistantMessage): {
  answerBlocks: AssistantContentBlock[];
  processBlocks: AssistantContentBlock[];
} {
  const blocks = getDisplayableAssistantBlocks(message);
  const lastProcessIndex = blocks.findLastIndex((block) => !isFinalAnswerBlock(block));
  if (lastProcessIndex === -1) {
    return { answerBlocks: blocks, processBlocks: [] };
  }
  return {
    answerBlocks: blocks.slice(lastProcessIndex + 1),
    processBlocks: blocks.slice(0, lastProcessIndex + 1),
  };
}

export function countToolCallBlocks(blocks: AssistantContentBlock[]): number {
  return blocks.filter((block): block is ToolCallContent => block.type === "toolCall").length;
}
