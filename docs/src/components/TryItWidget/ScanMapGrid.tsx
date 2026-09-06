import type {ReactNode} from 'react';
import type {Cell} from '@ethereum-radio/indexer/core/spans';
import styles from './styles.module.css';

interface ScanMapGridProps {
	cells: Cell[];
	selected: Cell | null;
	onSelect: (cell: Cell) => void;
}

const cellKey = (cell: Cell) => `${cell.fromBlock}-${cell.toBlock}`;

// A grid of blockRangeLimit-sized chunks, colored scanned/unscanned from
// Cursor.getCellStates() — click one to select it, then "Check for reorgs"
// (in the parent) compares its recorded header hash against the chain.
export default function ScanMapGrid({cells, selected, onSelect}: ScanMapGridProps): ReactNode {
	if (cells.length === 0) return null;

	return (
		<div className={styles.grid} role="group" aria-label="Scan progress by chunk">
			{cells.map((cell) => {
				const isSelected = selected != null && cellKey(selected) === cellKey(cell);
				const className = [
					styles.cell,
					cell.scanned ? styles.cellScanned : '',
					isSelected ? styles.cellSelected : '',
				]
					.filter(Boolean)
					.join(' ');
				return (
					<button
						key={cellKey(cell)}
						type="button"
						className={className}
						title={`blocks ${cell.fromBlock}–${cell.toBlock} (${cell.scanned ? 'scanned' : 'unscanned'})`}
						aria-pressed={isSelected}
						onClick={() => onSelect(cell)}
					/>
				);
			})}
		</div>
	);
}
