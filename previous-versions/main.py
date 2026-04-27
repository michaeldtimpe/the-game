"""
Main entry point for The Game
"""

import argparse

from animator import SelectionAnimator
from gui import GameUI
from rich.console import Console
from scanner import MovieScanner
from selector import MovieSelector
from storage import MovieStorage

console = Console()


def play_round(storage, scanner, selector, animator, ui, rebuild=False):
    """Execute one round of the game."""
    # Update storage
    scanner.rebuild_or_update(rebuild=rebuild)

    # Decrement weights
    storage.decrement_all_weights()

    # Animate and pick
    picks = animator.animate_and_pick()

    # Finalize run
    run_num = storage.increment_run_counter()

    # Update history with actual run number
    for movie in storage.data.get("movies", {}).values():
        if movie.get("history") and -1 in movie["history"]:
            movie["history"] = [run_num if v == -1 else v for v in movie["history"]]
            movie["history"] = movie["history"][:5]  # HISTORY_LENGTH

    storage.save()

    # Wait for user input before returning to menu
    console.print("\nPress [bold]Enter[/bold] to return to main menu.")
    try:
        import readchar

        readchar.readkey()
    except:
        input()


def main_loop(storage, scanner, selector, animator, ui):
    """Main menu loop."""
    while True:
        choice = ui.show_main_menu()

        if choice is None or choice == "quit":
            return

        if choice == "play":
            play_round(storage, scanner, selector, animator, ui, rebuild=False)

        elif choice == "add":
            new_dir = ui.prompt_add_directory()
            if new_dir:
                if storage.add_directory(new_dir):
                    storage.save()
                    ui.show_message("Added", f"Added directory:\n{new_dir}")
                else:
                    ui.show_message("Already Exists", f"Already configured: {new_dir}")

        elif choice == "remove":
            to_remove = ui.prompt_remove_directory()
            if to_remove:
                storage.remove_directory(to_remove)
                storage.save()
                ui.show_message("Removed", f"Removed {to_remove}")

        elif choice == "reset_weights":
            if ui.confirm_action(
                "Reset Weights",
                "Reset all weights to 0? This keeps movies and history.",
            ):
                storage.reset_all_weights()
                storage.save()
                console.print("[green]All movie weights have been reset to 0.[/green]")

        elif choice == "rebuild":
            if ui.confirm_action(
                "Force Rebuild",
                "Force a full rebuild (rescans all directories and text files)?",
            ):
                scanner.rebuild_or_update(rebuild=True)
                storage.save()
                ui.show_message("Rebuilt", "Full rebuild completed.")


def main():
    parser = argparse.ArgumentParser(description="The Game")
    parser.add_argument(
        "--rebuild", action="store_true", help="Force full rebuild on start"
    )
    parser.add_argument(
        "--reset-weights", action="store_true", help="Clear all stored weights to 0"
    )
    args = parser.parse_args()

    # Initialize components
    storage = MovieStorage()
    scanner = MovieScanner(storage)
    selector = MovieSelector(storage)
    animator = SelectionAnimator(storage, selector)
    ui = GameUI(storage)

    # Handle CLI flags
    if args.reset_weights:
        storage.reset_all_weights()
        storage.save()
        console.print("All weights reset. Exiting.")
        return

    if args.rebuild:
        scanner.rebuild_or_update(rebuild=True)
        storage.save()

    # Run main loop
    try:
        main_loop(storage, scanner, selector, animator, ui)
    except KeyboardInterrupt:
        console.print("\n[red]Interrupted by user.[/red]")
    finally:
        storage.save()
        console.print("Goodbye!")


if __name__ == "__main__":
    main()
