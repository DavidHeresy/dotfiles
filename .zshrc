#!/usr/bin/zsh

# Use vi mode.
bindkey -v

# Source profile and aliasrc.
source "$HOME/.config/profile"
source "$HOME/.config/zsh/aliasrc"

# Load and export environment variables.
set -a
. $HOME/.config/zsh/zsh.env
set +a

# List files at every directory change.
function chpwd() {
	emulate -L zsh
	clear
	l
}

# Enable zsh syntax highlighting and auto-quoting.
source ~/.config/zsh/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
source ~/.config/zsh/zsh-autoquoter/zsh-autoquoter.zsh
ZAQ_PREFIXES=('git commit( [^ ]##)# -[^ -]#m' 'ssh( [^ ]##)# [^ -][^ ]#' 'spotifydl' 'audio-dl' 'caption-dl' 'video-dl' 'rn' 'music' 's' 'bm add' 'gn' 'n a' 'bs bm a' 'bs n a' 'bm a' 'n s' 'bs n s' 'bs bm s' 'bm s' 'bs s' 'n g' 'bg n g' 'bg bm g' 'bm g' 'bg g' 'yt-dlp')
ZSH_HIGHLIGHT_HIGHLIGHTERS+=(zaq)


################################################################################
# Shell function for safe use of `apparition apparate`.
# Arguments:
#     $1: The destination name passed to `apparition apparate`
#         If the value is `--help` only the help text is shown.
#         Otherwise the command is executed with `eval`.
# Outputs:
#     Writes error messages to STDERR.
################################################################################
function apparate() {
	destination="$1"
	if [ $destination = "--help" ]; then
		apparition apparate --help
		return
	fi

	output=$(apparition apparate --called-from-shell-function "$1")

	if [ $? = 0 ]; then
		eval $output
	else
		apparition print-error "$output"
	fi
}

autoload -Uz compinit
compinit
zstyle ':completion:*' menu select
fpath+=~/.zfunc

# History search.
bindkey "^[OA" history-beginning-search-backward
bindkey "^[OB" history-beginning-search-forward

# List files at shell startup.
# set-title
l

# bun
[ -s "/home/david/.bun/_bun" ] && source "/home/david/.bun/_bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# modular
export MODULAR_HOME="/home/david/.modular"
export PATH="/home/david/.modular/pkg/packages.modular.com_mojo/bin:$PATH"

# Use the 'starship' prompt.
eval "$(starship init zsh)"
