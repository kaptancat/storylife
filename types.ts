
export interface Grade {
  id: string;
  name: string;
}

export interface Student {
  id: string;
  name: string;
  gradeId: string;
  workImage?: string; // base64
  extractedText?: string;
  evaluation?: Evaluation;
}

export interface Evaluation {
  handwritingScore: number;
  originalityScore: number;
  punctuationErrors: string[];
  conceptKnowledge: string;
  transcribedText: string; // Added to store the actual text from the image
  creativityScore: number;
  plagiarismNote: string;
  overallScore: number;
  weaknesses: string[];
  suggestions: {
    topic: string;
    action: string;
  }[];
}

export interface SavedReport {
  id: string;
  studentName: string;
  gradeName: string;
  timestamp: string;
  evaluation: Evaluation;
  workImage?: string;
}

export interface AppState {
  grades: Grade[];
  students: Student[];
  referenceText: string;
  savedReports: SavedReport[];
}
