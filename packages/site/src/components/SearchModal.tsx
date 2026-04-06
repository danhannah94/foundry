import { useState, useEffect, useRef } from 'react';

interface SearchResult {
  path: string;
  heading: string;
  snippet: string;
  score: number;
  charCount: number;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalResults: number;
  warning?: string;
}

export default function SearchModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Convert path like "methodology/process" to "Methodology Process"
  const pathToTitle = (path: string) => {
    return path
      .replace(/\.md$/, '') // Remove .md extension
      .split('/')
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  };

  // Slugify heading for URL fragments
  const slugifyHeading = (heading: string) => {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  };

  // Highlight search terms in snippet
  const highlightText = (text: string, searchQuery: string) => {
    if (!searchQuery.trim()) return text;
    
    const terms = searchQuery.trim().split(/\s+/);
    let highlightedText = text;
    
    terms.forEach(term => {
      if (term.length > 1) { // Only highlight terms longer than 1 char
        const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        highlightedText = highlightedText.replace(regex, '<mark>$1</mark>');
      }
    });
    
    return highlightedText;
  };

  // Search API call
  const performSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: searchQuery.trim(),
          topK: 10,
        }),
      });

      if (response.ok) {
        const data: SearchResponse = await response.json();
        setResults(data.results);
        setHasSearched(true);
      } else {
        console.error('Search failed:', response.statusText);
        setResults([]);
        setHasSearched(true);
      }
    } catch (error) {
      console.error('Search error:', error);
      setResults([]);
      setHasSearched(true);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Navigate to selected result
  const navigateToResult = (result: SearchResult) => {
    const slug = slugifyHeading(result.heading);
    const url = `/docs/${result.path.replace(/\.md$/, '')}#${slug}`;
    window.location.href = url;
    setIsOpen(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) {
        // Global Cmd+K / Ctrl+K handler
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setIsOpen(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }
        return;
      }

      // Modal is open - handle navigation keys
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setQuery('');
          setResults([]);
          setSelectedIndex(-1);
          setHasSearched(false);
          break;

        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
          break;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, -1));
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            navigateToResult(results[selectedIndex]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [results]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false);
      setQuery('');
      setResults([]);
      setSelectedIndex(-1);
      setHasSearched(false);
    }
  };

  const handleSearchIconClick = () => {
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  return (
    <>
      {/* Search icon button for header */}
      <button
        className="search-modal__icon-button"
        onClick={handleSearchIconClick}
        aria-label="Search docs"
        title="Search docs (Cmd+K)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="search-modal__backdrop" onClick={handleBackdropClick}>
          <div className="search-modal">
            <div className="search-modal__input-container">
              <svg 
                className="search-modal__search-icon"
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                className="search-modal__input"
                placeholder="Search docs..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="search-modal__clear-button"
                  onClick={() => {
                    setQuery('');
                    setResults([]);
                    setHasSearched(false);
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <div className="search-modal__content">
              {isLoading && (
                <div className="search-modal__loading">
                  Searching...
                </div>
              )}

              {!isLoading && hasSearched && results.length === 0 && query.trim() && (
                <div className="search-modal__no-results">
                  No results found for '{query}'
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <div className="search-modal__results">
                  {results.map((result, index) => (
                    <div
                      key={`${result.path}-${result.heading}-${index}`}
                      className={`search-modal__result ${index === selectedIndex ? 'search-modal__result--selected' : ''}`}
                      onClick={() => navigateToResult(result)}
                    >
                      <div className="search-modal__result-title">
                        {pathToTitle(result.path)}
                      </div>
                      <div className="search-modal__result-heading">
                        {result.heading}
                      </div>
                      <div 
                        className="search-modal__result-snippet"
                        dangerouslySetInnerHTML={{
                          __html: highlightText(result.snippet, query)
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {!isLoading && !hasSearched && (
                <div className="search-modal__empty">
                  {/* Empty state - just show the input */}
                </div>
              )}
            </div>

            <div className="search-modal__shortcuts">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>↵</kbd> select</span>
              <span><kbd>esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}