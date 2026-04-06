import React, { useEffect, useState } from 'react';

interface HeadingData {
  id: string;
  text: string;
  level: 2 | 3;
  element: HTMLElement;
}

export default function TableOfContents() {
  const [headings, setHeadings] = useState<HeadingData[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isThreadHidden, setIsThreadHidden] = useState(true);

  // Extract headings from the page content
  useEffect(() => {
    const headingElements = document.querySelectorAll('.content h2, .content h3');
    const headingData: HeadingData[] = Array.from(headingElements).map((element, index) => {
      const htmlElement = element as HTMLElement;
      let id = htmlElement.id;
      
      // Generate ID if missing
      if (!id) {
        const text = htmlElement.textContent || '';
        id = text
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '') // Remove special characters
          .replace(/[-\s]+/g, '-') // Replace spaces and multiple hyphens
          .replace(/^-+|-+$/g, ''); // Trim hyphens
        
        // Ensure uniqueness
        const baseId = id;
        let counter = 1;
        while (document.getElementById(id)) {
          id = `${baseId}-${counter}`;
          counter++;
        }
        
        htmlElement.id = id;
      }
      
      return {
        id,
        text: htmlElement.textContent || '',
        level: htmlElement.tagName.toLowerCase() === 'h2' ? 2 : 3,
        element: htmlElement
      };
    });

    setHeadings(headingData);
  }, []);

  // Set up IntersectionObserver for scroll spy
  useEffect(() => {
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        
        if (visibleEntries.length > 0) {
          // Find the topmost visible heading
          const sortedEntries = visibleEntries.sort((a, b) => {
            return a.boundingClientRect.top - b.boundingClientRect.top;
          });
          
          const targetId = sortedEntries[0].target.id;
          setActiveId(targetId);
        }
      },
      {
        rootMargin: '-10% 0px -70% 0px', // Trigger when heading is in the upper portion of viewport
        threshold: 0
      }
    );

    headings.forEach(({ element }) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [headings]);

  // Watch for thread panel visibility changes
  useEffect(() => {
    const checkThreadPanelVisibility = () => {
      const threadPanel = document.querySelector('.thread-panel');
      const isHidden = threadPanel?.classList.contains('thread-panel--hidden') ?? true;
      setIsThreadHidden(isHidden);
    };

    // Initial check
    checkThreadPanelVisibility();

    // Watch for changes
    const observer = new MutationObserver(checkThreadPanelVisibility);
    const threadPanel = document.querySelector('.thread-panel');
    
    if (threadPanel) {
      observer.observe(threadPanel, { 
        attributes: true, 
        attributeFilter: ['class'] 
      });
    }

    // Also observe body for when thread panel gets added dynamically
    const bodyObserver = new MutationObserver(() => {
      const threadPanel = document.querySelector('.thread-panel');
      if (threadPanel && !observer) {
        observer.observe(threadPanel, { 
          attributes: true, 
          attributeFilter: ['class'] 
        });
      }
      checkThreadPanelVisibility();
    });

    bodyObserver.observe(document.body, { 
      childList: true, 
      subtree: true 
    });

    return () => {
      observer.disconnect();
      bodyObserver.disconnect();
    };
  }, []);

  // Handle click navigation
  const handleClick = (heading: HeadingData) => {
    heading.element.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'start' 
    });
  };

  // Don't render if there are fewer than 2 headings or thread panel is visible
  if (headings.length < 2 || !isThreadHidden) {
    return null;
  }

  return (
    <div className="toc">
      <ul className="toc__list">
        {headings.map((heading) => (
          <li
            key={heading.id}
            className={`toc__item ${heading.level === 3 ? 'toc__item--h3' : ''} ${
              activeId === heading.id ? 'toc__item--active' : ''
            }`}
          >
            <button
              className="toc__link"
              onClick={() => handleClick(heading)}
              title={heading.text}
            >
              {heading.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}