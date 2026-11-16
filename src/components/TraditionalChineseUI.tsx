'use client';

import { useEffect } from 'react';

import { toTraditional } from '@/lib/chinese';

const EXCLUDED_TAGS = new Set([
  'CODE',
  'INPUT',
  'NOSCRIPT',
  'PRE',
  'SCRIPT',
  'STYLE',
  'TEXTAREA',
]);

function isExcluded(node: globalThis.Text): boolean {
  const parent = node.parentElement;
  return Boolean(parent && EXCLUDED_TAGS.has(parent.tagName));
}

function convertTextNodes(root: Node): void {
  const walker = document.createTreeWalker(root, 4);
  const textNodes: globalThis.Text[] = [];
  let node: Node | null;

  while ((node = walker.nextNode())) {
    if (node.nodeType === 3 && !isExcluded(node as globalThis.Text)) {
      textNodes.push(node as globalThis.Text);
    }
  }

  for (const textNode of textNodes) {
    const converted = toTraditional(textNode.data);
    if (converted !== textNode.data) {
      textNode.data = converted;
    }
  }
}

export default function TraditionalChineseUI() {
  useEffect(() => {
    convertTextNodes(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === 3) {
            if (!isExcluded(addedNode as globalThis.Text)) {
              const textNode = addedNode as globalThis.Text;
              textNode.data = toTraditional(textNode.data);
            }
          } else if (addedNode.nodeType === 1) {
            convertTextNodes(addedNode);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
